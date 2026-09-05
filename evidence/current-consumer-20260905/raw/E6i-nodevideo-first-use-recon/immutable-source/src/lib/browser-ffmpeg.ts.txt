export const FFMPEG_CORE_VERSION = '0.12.10' as const;
export const FFMPEG_ASSET_ROOT = `/ffmpeg/${FFMPEG_CORE_VERSION}` as const;
export const DEFAULT_MAX_FFMPEG_INPUT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MULTI_THREAD_LOAD_TIMEOUT_MS = 12_000;
export const DEFAULT_SINGLE_THREAD_LOAD_TIMEOUT_MS = 60_000;

export type BrowserFfmpegCoreKind = 'single-thread' | 'multi-thread';
export type BrowserFfmpegPhase =
  | 'loading-core'
  | 'writing-inputs'
  | 'rendering'
  | 'reading-output'
  | 'complete';

export interface BrowserFfmpegProgress {
  phase: BrowserFfmpegPhase;
  /** Overall progress, always clamped to the inclusive 0..1 range. */
  ratio: number;
  coreKind?: BrowserFfmpegCoreKind;
  frame?: number;
}

export interface BrowserFfmpegFile {
  /** A flat, compiler-generated MEMFS filename. Paths and traversal are rejected. */
  name: string;
  data: Uint8Array | string;
}

export interface BrowserFfmpegExecuteOptions {
  args: readonly string[];
  files: readonly BrowserFfmpegFile[];
  outputFile: string;
  expectedFrames?: number;
  durationSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserFfmpegProgress) => void;
}

export interface BrowserFfmpegExecuteResult {
  data: Uint8Array;
  coreKind: BrowserFfmpegCoreKind;
}

export interface BrowserFfmpegEnvironment {
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
}

export interface BrowserFfmpegLoadConfig {
  coreURL: string;
  wasmURL: string;
  workerURL?: string;
}

interface FfmpegLogEvent {
  type: string;
  message: string;
}

/** The small FFmpeg surface used here, kept injectable for deterministic unit tests. */
export interface BrowserFfmpegInstance {
  load(config: BrowserFfmpegLoadConfig, options?: { signal?: AbortSignal }): Promise<boolean>;
  exec(args: string[], timeout?: number, options?: { signal?: AbortSignal }): Promise<number>;
  writeFile(
    path: string,
    data: Uint8Array | string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>;
  readFile(
    path: string,
    encoding?: string,
    options?: { signal?: AbortSignal },
  ): Promise<Uint8Array | string>;
  deleteFile(path: string, options?: { signal?: AbortSignal }): Promise<boolean>;
  on(event: 'log', callback: (event: FfmpegLogEvent) => void): void;
  off(event: 'log', callback: (event: FfmpegLogEvent) => void): void;
  terminate(): void;
}

export type BrowserFfmpegFactory = () => Promise<BrowserFfmpegInstance>;

export interface BrowserFfmpegRuntimeOptions {
  factory?: BrowserFfmpegFactory;
  environment?: BrowserFfmpegEnvironment;
  assetRoot?: string;
  maxInputBytes?: number;
  preferMultiThread?: boolean;
  multiThreadLoadTimeoutMs?: number;
  singleThreadLoadTimeoutMs?: number;
}

export function canUseMultithread(
  environment: BrowserFfmpegEnvironment = globalThis as BrowserFfmpegEnvironment,
): boolean {
  return (
    environment.crossOriginIsolated === true && typeof environment.SharedArrayBuffer === 'function'
  );
}

export function coreLoadConfig(
  kind: BrowserFfmpegCoreKind,
  assetRoot: string = FFMPEG_ASSET_ROOT,
): BrowserFfmpegLoadConfig {
  const root = assetRoot.replace(/\/+$/u, '');
  const directory = kind === 'multi-thread' ? 'mt' : 'st';
  return {
    coreURL: `${root}/${directory}/ffmpeg-core.js`,
    wasmURL: `${root}/${directory}/ffmpeg-core.wasm`,
    ...(kind === 'multi-thread' ? { workerURL: `${root}/${directory}/ffmpeg-core.worker.js` } : {}),
  };
}

function defaultEnvironment(): BrowserFfmpegEnvironment {
  return globalThis as BrowserFfmpegEnvironment;
}

async function defaultFactory(): Promise<BrowserFfmpegInstance> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  return new FFmpeg();
}

function abortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Browser video export was cancelled.', 'AbortError');
  }
  const error = new Error('Browser video export was cancelled.');
  error.name = 'AbortError';
  return error;
}

function normalizedError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertSafeFileName(name: string, label: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(name) ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`${label} must be a flat, safe MEMFS filename.`);
  }
}

function fileByteLength(data: Uint8Array | string): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * Owns one reusable ffmpeg.wasm worker. Calls are serialized by rejecting while
 * busy, and cancellation terminates the worker because AbortSignal alone does
 * not stop the underlying WASM execution.
 */
export class BrowserFfmpegRuntime {
  private readonly factory: BrowserFfmpegFactory;
  private readonly environment: BrowserFfmpegEnvironment;
  private readonly assetRoot: string;
  private readonly maxInputBytes: number;
  private readonly preferMultiThread: boolean;
  private readonly multiThreadLoadTimeoutMs: number;
  private readonly singleThreadLoadTimeoutMs: number;
  private ffmpeg: BrowserFfmpegInstance | null = null;
  private coreKind: BrowserFfmpegCoreKind | null = null;
  private busy = false;
  private cancelActive: (() => void) | null = null;

  constructor(options: BrowserFfmpegRuntimeOptions = {}) {
    this.factory = options.factory ?? defaultFactory;
    this.environment = options.environment ?? defaultEnvironment();
    this.assetRoot = options.assetRoot ?? FFMPEG_ASSET_ROOT;
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_FFMPEG_INPUT_BYTES;
    // Pthread support is opt-in. Some cross-origin-isolated Chromium runtimes
    // load the MT core, then fail when the codec actually spawns threads. The
    // ST core is slower but deterministic across the supported browser set.
    this.preferMultiThread = options.preferMultiThread ?? false;
    this.multiThreadLoadTimeoutMs =
      options.multiThreadLoadTimeoutMs ?? DEFAULT_MULTI_THREAD_LOAD_TIMEOUT_MS;
    this.singleThreadLoadTimeoutMs =
      options.singleThreadLoadTimeoutMs ?? DEFAULT_SINGLE_THREAD_LOAD_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.maxInputBytes) || this.maxInputBytes <= 0) {
      throw new Error('maxInputBytes must be a positive safe integer.');
    }
    if (!finitePositive(this.multiThreadLoadTimeoutMs)) {
      throw new Error('multiThreadLoadTimeoutMs must be a positive finite number.');
    }
    if (!finitePositive(this.singleThreadLoadTimeoutMs)) {
      throw new Error('singleThreadLoadTimeoutMs must be a positive finite number.');
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async execute(options: BrowserFfmpegExecuteOptions): Promise<BrowserFfmpegExecuteResult> {
    if (this.busy) throw new Error('A browser video export is already running.');
    this.validateExecution(options);
    if (options.signal?.aborted) throw abortError();

    this.busy = true;
    let cancelled = false;
    let logListener: ((event: FfmpegLogEvent) => void) | null = null;
    const touchedFiles = [...options.files.map((file) => file.name), options.outputFile];
    const logTail: string[] = [];
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      this.terminateWorker();
    };
    this.cancelActive = cancel;
    options.signal?.addEventListener('abort', cancel, { once: true });

    try {
      options.onProgress?.({ phase: 'loading-core', ratio: 0.01 });
      const { ffmpeg, kind } = await this.ensureLoaded(options.signal, () => cancelled);
      if (cancelled || options.signal?.aborted) throw abortError();
      options.onProgress?.({ phase: 'loading-core', ratio: 0.05, coreKind: kind });

      let lastRenderRatio = 0;
      logListener = ({ message }) => {
        logTail.push(message);
        if (logTail.length > 50) logTail.shift();
        const frameMatch = /(?:^|\s)frame\s*=\s*(\d+)/u.exec(message);
        const timeMatch = /(?:^|\s)out_time_(?:ms|us)\s*=\s*(\d+)/u.exec(message);
        const frame = frameMatch ? Number(frameMatch[1]) : undefined;
        const frameRatio =
          frame !== undefined && finitePositive(options.expectedFrames)
            ? frame / options.expectedFrames
            : 0;
        // FFmpeg's progress protocol calls this field out_time_ms, but reports microseconds.
        const timeRatio =
          timeMatch && finitePositive(options.durationSeconds)
            ? Number(timeMatch[1]) / (options.durationSeconds * 1_000_000)
            : 0;
        const renderRatio = clampRatio(Math.max(frameRatio, timeRatio));
        if (renderRatio > lastRenderRatio) {
          lastRenderRatio = renderRatio;
          options.onProgress?.({
            phase: 'rendering',
            ratio: 0.1 + renderRatio * 0.85,
            coreKind: kind,
            ...(frame !== undefined ? { frame } : {}),
          });
        }
      };
      ffmpeg.on('log', logListener);

      for (const [index, file] of options.files.entries()) {
        if (cancelled || options.signal?.aborted) throw abortError();
        await ffmpeg.writeFile(file.name, file.data, { signal: options.signal });
        options.onProgress?.({
          phase: 'writing-inputs',
          ratio: 0.05 + ((index + 1) / Math.max(1, options.files.length)) * 0.05,
          coreKind: kind,
        });
      }

      if (cancelled || options.signal?.aborted) throw abortError();
      options.onProgress?.({ phase: 'rendering', ratio: 0.1, coreKind: kind });
      const exitCode = await ffmpeg.exec([...options.args], undefined, {
        signal: options.signal,
      });
      if (cancelled || options.signal?.aborted) throw abortError();
      if (exitCode !== 0) {
        const detail = logTail.slice(-8).join('\n');
        throw new Error(
          `Browser FFmpeg exited with code ${exitCode}.${detail ? `\n${detail}` : ''}`,
        );
      }

      options.onProgress?.({ phase: 'reading-output', ratio: 0.97, coreKind: kind });
      const output = await ffmpeg.readFile(options.outputFile, undefined, {
        signal: options.signal,
      });
      if (!(output instanceof Uint8Array) || output.byteLength === 0) {
        throw new Error('Browser FFmpeg did not produce a non-empty binary output.');
      }
      const data = new Uint8Array(output);
      options.onProgress?.({ phase: 'complete', ratio: 1, coreKind: kind });
      return { data, coreKind: kind };
    } catch (error) {
      if (cancelled || options.signal?.aborted) {
        this.terminateWorker();
        throw abortError();
      }
      // A failed native command can leave MEMFS or codec state inconsistent.
      // Fail closed and make the next attempt initialize a fresh worker.
      this.terminateWorker();
      throw normalizedError(error);
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      const worker = this.ffmpeg;
      if (worker && logListener) worker.off('log', logListener);
      if (worker) {
        for (const file of touchedFiles) {
          try {
            await worker.deleteFile(file);
          } catch {
            // Missing files and a just-terminated worker are both expected cleanup cases.
          }
        }
      }
      this.cancelActive = null;
      this.busy = false;
    }
  }

  cancel(): void {
    this.cancelActive?.();
  }

  dispose(): void {
    this.cancelActive?.();
    this.terminateWorker();
  }

  private validateExecution(options: BrowserFfmpegExecuteOptions): void {
    assertSafeFileName(options.outputFile, 'outputFile');
    if (options.args.length === 0 || options.args.some((argument) => argument.includes('\0'))) {
      throw new Error('FFmpeg arguments must be non-empty and cannot contain NUL bytes.');
    }
    const names = new Set<string>();
    let totalBytes = 0;
    for (const file of options.files) {
      assertSafeFileName(file.name, 'input file name');
      if (file.name === options.outputFile || names.has(file.name)) {
        throw new Error(`Duplicate browser FFmpeg filename: ${file.name}`);
      }
      names.add(file.name);
      totalBytes += fileByteLength(file.data);
      if (!Number.isSafeInteger(totalBytes) || totalBytes > this.maxInputBytes) {
        throw new Error(
          `Browser FFmpeg inputs exceed the ${this.maxInputBytes}-byte memory safety limit.`,
        );
      }
    }
    if (options.expectedFrames !== undefined && !finitePositive(options.expectedFrames)) {
      throw new Error('expectedFrames must be a positive finite number.');
    }
    if (options.durationSeconds !== undefined && !finitePositive(options.durationSeconds)) {
      throw new Error('durationSeconds must be a positive finite number.');
    }
  }

  private async ensureLoaded(
    signal: AbortSignal | undefined,
    isCancelled: () => boolean,
  ): Promise<{ ffmpeg: BrowserFfmpegInstance; kind: BrowserFfmpegCoreKind }> {
    if (this.ffmpeg && this.coreKind) return { ffmpeg: this.ffmpeg, kind: this.coreKind };

    const preferred: BrowserFfmpegCoreKind =
      this.preferMultiThread && canUseMultithread(this.environment)
        ? 'multi-thread'
        : 'single-thread';
    try {
      return await this.loadFresh(preferred, signal);
    } catch (error) {
      if (preferred !== 'multi-thread' || signal?.aborted || isCancelled()) throw error;
      this.terminateWorker();
      return this.loadFresh('single-thread', signal);
    }
  }

  private async loadFresh(
    kind: BrowserFfmpegCoreKind,
    signal?: AbortSignal,
  ): Promise<{ ffmpeg: BrowserFfmpegInstance; kind: BrowserFfmpegCoreKind }> {
    const ffmpeg = await this.factory();
    this.ffmpeg = ffmpeg;
    this.coreKind = null;
    const timeoutMs =
      kind === 'multi-thread' ? this.multiThreadLoadTimeoutMs : this.singleThreadLoadTimeoutMs;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ffmpeg.load(coreLoadConfig(kind, this.assetRoot), { signal }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${kind} FFmpeg core load timed out after ${timeoutMs}ms.`)),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (this.ffmpeg === ffmpeg) {
        this.ffmpeg = null;
        this.coreKind = null;
      }
      ffmpeg.terminate();
      throw normalizedError(error);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    this.coreKind = kind;
    return { ffmpeg, kind };
  }

  private terminateWorker(): void {
    const worker = this.ffmpeg;
    this.ffmpeg = null;
    this.coreKind = null;
    worker?.terminate();
  }
}
