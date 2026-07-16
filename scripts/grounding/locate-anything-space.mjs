import { Client, handle_file } from '@gradio/client';

const DEFAULT_SPACE = 'nvidia/LocateAnything';

export async function locateAnythingOnImage({
  imagePath,
  query,
  task = 'grounding',
  output = 'box',
  token = process.env.HF_TOKEN,
  space = process.env.NODEVIDEO_LOCATEANYTHING_SPACE ?? DEFAULT_SPACE,
}) {
  if (!imagePath) throw new Error('imagePath is required');
  if (!query || query.length > 1_000) throw new Error('query must contain 1-1000 characters');
  if (!['grounding', 'detection', 'pointing'].includes(task)) throw new Error('unsupported task');
  if (!['box', 'point'].includes(output)) throw new Error('unsupported output');

  const client = await Client.connect(space, token ? { token } : undefined);
  const response = await client.predict('/run_inference', {
    input_type: 'Image',
    image_file: handle_file(imagePath),
    video_file: null,
    task_type: taskLabel(task, output),
    category: query,
    model_mode: 'hybrid',
    temp: 0.2,
    top_p: 0.9,
    top_k: 20,
    short_size: null,
    question_override: query,
    max_video_frames: 1,
  });
  const [annotated, _video, metadata] = response.data;
  if (!metadata || typeof metadata !== 'object' || metadata.success !== true) {
    throw new Error('LocateAnything Space returned an unsuccessful response');
  }
  const detections = normalizeDetections(metadata.detections, output);
  return {
    space,
    modelId: 'nvidia/LocateAnything-3B',
    rawText: String(metadata.raw_text ?? ''),
    detections,
    stats: sanitizeStats(metadata.stats),
    annotatedImageUrl:
      annotated && typeof annotated === 'object' && typeof annotated.url === 'string'
        ? annotated.url
        : undefined,
  };
}

export function toLocateResult(request, inference) {
  const observations = inference.detections.map((item, index) => ({
    id: `observation.locate-anything.${index + 1}`,
    geometry:
      item.type === 'box'
        ? {
            kind: 'box',
            box: {
              x: item.coords[0] / 1_000,
              y: item.coords[1] / 1_000,
              width: (item.coords[2] - item.coords[0]) / 1_000,
              height: (item.coords[3] - item.coords[1]) / 1_000,
            },
          }
        : { kind: 'point', point: { x: item.coords[0] / 1_000, y: item.coords[1] / 1_000 } },
    label: item.label,
  }));
  return {
    schemaVersion: 'nodevideo.locate-result.v1',
    requestId: request.requestId,
    traceId: request.traceId,
    assetId: request.assetId,
    provider: {
      id: 'provider.locate-anything.official-space',
      implementation: 'locate-anything-http',
      modelId: inference.modelId,
    },
    status:
      observations.length === 0
        ? 'empty'
        : request.cardinality === 'one' && observations.length > 1
          ? 'ambiguous'
          : 'valid',
    observations,
  };
}

function taskLabel(task, output) {
  if (task === 'detection') return 'Detection';
  if (task === 'pointing' || output === 'point') return 'Pointing';
  return 'Grounding';
}

function normalizeDetections(value, output) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.coords)) return [];
    const expected = output === 'box' ? 4 : 2;
    if (item.coords.length !== expected) return [];
    const coords = item.coords.map(Number);
    if (coords.some((number) => !Number.isFinite(number) || number < 0 || number > 1_000))
      return [];
    if (expected === 4 && (coords[2] <= coords[0] || coords[3] <= coords[1])) return [];
    return [{ label: String(item.label ?? 'located subject').slice(0, 256), type: output, coords }];
  });
}

function sanitizeStats(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key.length <= 80 && ['string', 'number'].includes(typeof item))
      .map(([key, item]) => [key, String(item).slice(0, 80)]),
  );
}
