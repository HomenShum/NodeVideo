import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { EXECUTOR_SCHEMA, type ExecutorDefinition } from './media-orchestration-contracts.ts';

const execFileAsync = promisify(execFile);

export type CommandResult = { stdout: string; stderr: string; exitCode: number };
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export type HiggsfieldGenerationRequest = {
  jobType: string;
  prompt: string;
  parameters: Record<string, string | number | boolean>;
  references?: {
    images?: string[];
    videos?: string[];
    audio?: string[];
    startImage?: string;
    endImage?: string;
  };
};

export type HiggsfieldEntitlementSnapshot = {
  capturedAt: string;
  source: 'cli' | 'browser';
  signedIn: boolean;
  workspaceSelected: boolean;
  plan?: string;
  credits?: number;
  promotion?: {
    label: string;
    startsAt?: string;
    expiresAt?: string;
    eligibleSurfaces: Array<'browser' | 'cli' | 'mcp' | 'apps'>;
    eligibleModels: string[];
    concurrency?: number;
    watermark?: boolean;
    renewalRequired?: boolean;
  };
  rawEvidenceRef?: string;
  limitations: string[];
};

function defaultRunner(command: string, args: string[]): Promise<CommandResult> {
  return execFileAsync(command, args, {
    windowsHide: true,
    timeout: 30 * 60 * 1_000,
    maxBuffer: 64 * 1024 * 1024,
  })
    .then(({ stdout, stderr }) => ({ stdout, stderr, exitCode: 0 }))
    .catch((error: unknown) => {
      const candidate = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      return {
        stdout: candidate.stdout ?? '',
        stderr: candidate.stderr ?? candidate.message ?? 'Higgsfield CLI failed',
        exitCode: typeof candidate.code === 'number' ? candidate.code : 1,
      };
    });
}

function redact(value: string) {
  return value
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_.-]{16,}/gu, '<REDACTED_TOKEN>')
    .replace(/(access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*\S+/giu, '$1=REDACTED');
}

function parseJson(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(
      ...['{', '['].map((character) => {
        const index = trimmed.indexOf(character);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    if (Number.isFinite(start)) return JSON.parse(trimmed.slice(start));
    throw new Error('Higgsfield CLI returned non-JSON output');
  }
}

function flagName(name: string) {
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error(`Unsafe Higgsfield parameter: ${name}`);
  return `--${name}`;
}

function appendParameters(args: string[], parameters: Record<string, string | number | boolean>) {
  for (const [name, value] of Object.entries(parameters).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const flag = flagName(name);
    if (typeof value === 'boolean') {
      if (value) args.push(flag);
    } else {
      args.push(flag, String(value));
    }
  }
}

export class HiggsfieldCliClient {
  private readonly runner: CommandRunner;
  private readonly command: string;
  private readonly commandPrefix: string[];

  constructor(
    runner: CommandRunner = defaultRunner,
    command = process.platform === 'win32' ? process.execPath : 'npx',
    commandPrefix = process.platform === 'win32'
      ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')]
      : [],
  ) {
    this.runner = runner;
    this.command = command;
    this.commandPrefix = commandPrefix;
  }

  private async call(args: string[]) {
    const result = await this.runner(this.command, [
      ...this.commandPrefix,
      '-y',
      '-p',
      '@higgsfield/cli@1.1.19',
      'higgsfield',
      '--json',
      ...args,
    ]);
    if (result.exitCode !== 0) throw new Error(redact(result.stderr || result.stdout));
    return parseJson(result.stdout);
  }

  accountStatus() {
    return this.call(['account', 'status']);
  }

  listModels(kind?: 'image' | 'video' | 'audio' | 'text') {
    return this.call(['model', 'list', ...(kind ? [`--${kind}`] : [])]);
  }

  estimateCost(request: HiggsfieldGenerationRequest) {
    return this.call(['generate', 'cost', ...generationArgs(request)]);
  }

  createGeneration(request: HiggsfieldGenerationRequest) {
    return this.call(['generate', 'create', ...generationArgs(request)]);
  }

  getGeneration(jobId: string) {
    return this.call(['generate', 'get', safeId(jobId)]);
  }

  waitForGeneration(jobId: string, timeout = '20m', interval = '5s') {
    return this.call([
      'generate',
      'wait',
      safeId(jobId),
      '--wait-timeout',
      timeout,
      '--wait-interval',
      interval,
    ]);
  }

  listGenerations() {
    return this.call(['generate', 'list']);
  }

  upload(path: string) {
    if (!path.trim()) throw new Error('Upload path is required');
    return this.call(['upload', 'create', path]);
  }
}

function safeId(value: string) {
  if (!/^[a-zA-Z0-9:_-]+$/u.test(value)) throw new Error('Unsafe provider job ID');
  return value;
}

export function generationArgs(request: HiggsfieldGenerationRequest) {
  const args = [safeId(request.jobType), '--prompt', request.prompt];
  appendParameters(args, request.parameters);
  for (const image of request.references?.images ?? []) args.push('--image-references', image);
  for (const video of request.references?.videos ?? []) args.push('--video-references', video);
  for (const audio of request.references?.audio ?? []) args.push('--audio-references', audio);
  if (request.references?.startImage) args.push('--start-image', request.references.startImage);
  if (request.references?.endImage) args.push('--end-image', request.references.endImage);
  return args;
}

export function higgsfieldExecutorDefinitions(options: {
  enabled: boolean;
  promotionAppliesToCli: boolean;
}): ExecutorDefinition[] {
  const price = options.promotionAppliesToCli ? 0 : 3;
  const common = {
    schemaVersion: EXECUTOR_SCHEMA,
    version: '1.1.19',
    runtime: 'api' as const,
    cost: { tier: (price === 0 ? 'free' : 'medium') as 'free' | 'medium', estimatedUsd: price },
    latency: 'long' as const,
    deterministic: false,
    qualityTier: 'premium' as const,
    privacy: { sendsMediaOffDevice: true, sendsDerivedFrames: true },
    requirements: { gpu: false },
    license: { code: 'Proprietary', commercialUse: true },
    enabled: options.enabled,
  };
  return [
    {
      ...common,
      id: 'executor.higgsfield-video',
      capabilities: ['video.generate', 'video.transform', 'reference.analyze', 'video.upscale'],
      validatorIds: ['provider-job.complete', 'media.probe', 'asset-receipt.schema'],
    },
    {
      ...common,
      id: 'executor.higgsfield-image',
      capabilities: ['image.generate', 'image.edit', 'image.upscale', 'background.remove'],
      validatorIds: ['provider-job.complete', 'image.probe', 'asset-receipt.schema'],
    },
    {
      ...common,
      id: 'executor.higgsfield-audio',
      capabilities: ['audio.generate', 'voice.generate', 'lipsync.generate'],
      validatorIds: ['provider-job.complete', 'audio.probe', 'asset-receipt.schema'],
    },
  ];
}
