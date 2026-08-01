import { higgsfieldExecutorDefinitions } from './higgsfield-provider.ts';
import { EXECUTOR_SCHEMA, type ExecutorDefinition } from './media-orchestration-contracts.ts';

export type ExecutorEnvironment = {
  localMediaWorker: boolean;
  whisper: boolean;
  sceneDetect: boolean;
  opencv: boolean;
  higgsfieldAuthenticated: boolean;
  higgsfieldPromotionAppliesToCli: boolean;
  gpuVramGb?: number;
};

const local = (
  id: string,
  capabilities: string[],
  options: Partial<ExecutorDefinition> = {},
): ExecutorDefinition => ({
  schemaVersion: EXECUTOR_SCHEMA,
  id,
  version: '1.0.0',
  capabilities,
  runtime: 'local-worker',
  cost: { tier: 'free', estimatedUsd: 0 },
  latency: 'short',
  deterministic: true,
  qualityTier: 'standard',
  privacy: { sendsMediaOffDevice: false, sendsDerivedFrames: false },
  requirements: { gpu: false },
  license: { code: 'OSS', commercialUse: true },
  validatorIds: ['artifact.schema', 'artifact.provenance'],
  enabled: true,
  ...options,
});

export function buildExecutorCatalog(environment: ExecutorEnvironment): ExecutorDefinition[] {
  return [
    local('executor.ffprobe', ['media.probe', 'media.index'], {
      enabled: environment.localMediaWorker,
      latency: 'interactive',
    }),
    local('executor.ffmpeg-silencedetect', ['speech.detect-silence', 'audio.detect-regions'], {
      enabled: environment.localMediaWorker,
      latency: 'interactive',
    }),
    local('executor.openai-whisper-local', ['speech.transcribe', 'speech.detect-fillers'], {
      enabled: environment.whisper,
      deterministic: false,
      qualityTier: 'standard',
      latency: 'long',
      license: { code: 'MIT', model: 'Whisper model weights', commercialUse: true },
    }),
    local('executor.pyscenedetect', ['video.detect-shots'], {
      enabled: environment.sceneDetect,
      latency: 'short',
      license: { code: 'BSD-3-Clause', commercialUse: true },
    }),
    local('executor.opencv-subject-tracker', ['video.detect-subjects', 'video.reframe'], {
      enabled: environment.opencv,
      deterministic: false,
      license: { code: 'Apache-2.0', commercialUse: true },
    }),
    local(
      'executor.ffmpeg-edit-plan',
      ['video.render', 'audio.preserve', 'audio.normalize', 'caption.render'],
      {
        enabled: environment.localMediaWorker,
        latency: 'long',
        license: { code: 'LGPL-2.1-or-later', commercialUse: true },
      },
    ),
    local('executor.remotion', ['video.preview', 'motion-graphics.render'], {
      runtime: 'browser',
      enabled: true,
      license: { code: 'Remotion license', commercialUse: 'review-required' },
    }),
    ...higgsfieldExecutorDefinitions({
      enabled: environment.higgsfieldAuthenticated,
      promotionAppliesToCli: environment.higgsfieldPromotionAppliesToCli,
    }),
    local('executor.auto-editor', ['speech.remove-silence', 'video.rough-cut'], {
      enabled: false,
      version: 'not-installed',
      license: { code: 'LGPL-3.0', commercialUse: true },
    }),
    local('executor.openstoryline', ['story.plan', 'video.long-form-assemble'], {
      enabled: false,
      version: 'not-installed',
      deterministic: false,
      license: { code: 'review-required', commercialUse: 'review-required' },
    }),
    local('executor.trellis', ['3d.generate-mesh'], {
      enabled: false,
      version: 'not-installed',
      deterministic: false,
      requirements: { gpu: true, minimumVramGb: 16 },
      license: { code: 'MIT', model: 'review-required', commercialUse: 'review-required' },
    }),
    local('executor.vggt', ['3d.reconstruct-scene'], {
      enabled: false,
      version: 'not-installed',
      deterministic: false,
      requirements: { gpu: true, minimumVramGb: 16 },
      license: {
        code: 'review-required',
        model: 'review-required',
        commercialUse: 'review-required',
      },
    }),
  ];
}
