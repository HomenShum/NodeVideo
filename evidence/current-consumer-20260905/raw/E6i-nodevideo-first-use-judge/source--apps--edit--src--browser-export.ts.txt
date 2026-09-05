import {
  BROWSER_EDIT_EXPORT_FONT,
  BROWSER_EDIT_EXPORT_OUTPUT,
  type BrowserEditAssetBindings,
  type BrowserEditExportManifest,
  compileBrowserEditPlan,
} from '@/lib/browser-edit-plan-compiler';
import {
  type BrowserFfmpegCoreKind,
  type BrowserFfmpegProgress,
  BrowserFfmpegRuntime,
} from '@/lib/browser-ffmpeg';

export interface BrowserEditAssetSource {
  url: string;
  fileName: string;
}

export const DEFAULT_BROWSER_EDIT_ASSETS: Readonly<Record<string, BrowserEditAssetSource>> =
  Object.freeze({
    'asset.take-a': {
      url: '/media/authorized-real-v1/source-a-web.mp4',
      fileName: 'take-a.mp4',
    },
    'asset.take-b': {
      url: '/media/authorized-real-v1/source-b-web.mp4',
      fileName: 'take-b.mp4',
    },
  });

export const BROWSER_EDIT_EXPORT_FONT_URL = `/ffmpeg/0.12.10/${BROWSER_EDIT_EXPORT_FONT}` as const;

export interface BrowserEditExportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BrowserFfmpegProgress) => void;
  runtime?: BrowserFfmpegRuntime;
  fetcher?: typeof fetch;
  assetSources?: Readonly<Record<string, BrowserEditAssetSource>>;
  fileName?: string;
}

export interface BrowserEditExportResult {
  blob: Blob;
  bytes: Uint8Array;
  fileName: string;
  coreKind: BrowserFfmpegCoreKind;
  manifest: BrowserEditExportManifest;
}

const sharedRuntime = new BrowserFfmpegRuntime();
let activeSharedAbort: AbortController | null = null;

function createExportSignal(signal?: AbortSignal): {
  controller: AbortController;
  unlink: () => void;
} {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  return {
    controller,
    unlink: () => signal?.removeEventListener('abort', forwardAbort),
  };
}

async function fetchBinary(
  fetcher: typeof fetch,
  url: string,
  label: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetcher(url, { credentials: 'same-origin', signal });
  if (!response.ok) {
    throw new Error(`Could not load ${label} (${response.status} ${response.statusText}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`${label} is empty.`);
  return bytes;
}

function assertMp4(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 12 ||
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    throw new Error('Browser FFmpeg output is not a valid MP4 file (missing ftyp box).');
  }
}

/**
 * Compiles the accepted edit plan and renders a silent H.264 MP4 entirely in
 * this tab. Source media is fetched from same-origin URLs and never uploaded.
 */
export async function exportBrowserEditPlan(
  plan: unknown,
  options: BrowserEditExportOptions = {},
): Promise<BrowserEditExportResult> {
  const runtime = options.runtime ?? sharedRuntime;
  const usingSharedRuntime = runtime === sharedRuntime;
  if (usingSharedRuntime && activeSharedAbort) {
    throw new Error('A browser video export is already running.');
  }

  const { controller, unlink } = createExportSignal(options.signal);
  if (usingSharedRuntime) activeSharedAbort = controller;
  try {
    const assetSources = options.assetSources ?? DEFAULT_BROWSER_EDIT_ASSETS;
    const bindings: BrowserEditAssetBindings = Object.fromEntries(
      Object.entries(assetSources).map(([assetId, source]) => [assetId, source.fileName]),
    );
    const compiled = compileBrowserEditPlan(plan, bindings, {
      fontFileName: BROWSER_EDIT_EXPORT_FONT,
      outputFile: BROWSER_EDIT_EXPORT_OUTPUT,
    });
    const fetcher = options.fetcher ?? fetch;
    const [assetFiles, fontData] = await Promise.all([
      Promise.all(
        compiled.inputs.map(async ({ assetId, fileName }) => {
          const source = assetSources[assetId];
          if (!source) throw new Error(`Missing browser asset source for ${assetId}.`);
          return {
            name: fileName,
            data: await fetchBinary(fetcher, source.url, assetId, controller.signal),
          };
        }),
      ),
      fetchBinary(fetcher, BROWSER_EDIT_EXPORT_FONT_URL, 'browser export font', controller.signal),
    ]);

    const result = await runtime.execute({
      args: compiled.args,
      files: [
        ...assetFiles,
        { name: compiled.fontFileName, data: fontData },
        ...compiled.auxiliaryFiles,
      ],
      outputFile: compiled.outputFile,
      expectedFrames: compiled.expectedFrames,
      durationSeconds: compiled.durationSeconds,
      signal: controller.signal,
      onProgress: options.onProgress,
    });
    assertMp4(result.data);
    const bytes = new Uint8Array(result.data);
    return {
      blob: new Blob([bytes.buffer], { type: 'video/mp4' }),
      bytes,
      fileName: options.fileName ?? compiled.outputFile,
      coreKind: result.coreKind,
      manifest: compiled.manifest,
    };
  } finally {
    unlink();
    if (usingSharedRuntime && activeSharedAbort === controller) activeSharedAbort = null;
  }
}

export function cancelBrowserEditExport(): void {
  activeSharedAbort?.abort();
  sharedRuntime.cancel();
}

export function disposeBrowserEditExporter(): void {
  activeSharedAbort?.abort();
  activeSharedAbort = null;
  sharedRuntime.dispose();
}
