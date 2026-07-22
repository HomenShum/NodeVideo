import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vitest/config';
import { localPrivatePreview } from './scripts/dev/local-private-preview';

// MediaPipe's WASM runtime must be same-origin (the CSP blocks CDNs). Serve it
// from the npm package in dev, and copy it into dist at build time (see
// scripts/quality/copy-mediapipe-wasm.mjs in the build chain).
function mediapipeWasm(): Plugin {
  const wasmDir = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
  return {
    name: 'nodevideo-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe-wasm', (req, res, next) => {
        const file = path.join(wasmDir, (req.url ?? '/').replace(/^\//, ''));
        if (!file.startsWith(wasmDir)) return next();
        import('node:fs').then((fs) => {
          if (!fs.existsSync(file)) return next();
          res.setHeader(
            'content-type',
            file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
          );
          fs.createReadStream(file).pipe(res);
        });
      });
    },
  };
}

function creatorbenchPublicEvidence(): Plugin {
  return {
    name: 'nodevideo-creatorbench-public-evidence',
    closeBundle() {
      const sourceDir = path.resolve(__dirname, 'benchmarks/creatorbench-v1/results');
      const outputDir = path.resolve(__dirname, 'dist/benchmarks/creatorbench-v1/results');
      mkdirSync(outputDir, { recursive: true });
      for (const name of ['public-report.json', 'public-report.csv']) {
        const source = path.join(sourceDir, name);
        if (existsSync(source)) copyFileSync(source, path.join(outputDir, name));
      }
    },
  };
}

const isolatedEditorPages = new Set([
  '/edit',
  '/edit/',
  '/edit.html',
  '/creator',
  '/creator/',
  '/creator.html',
  '/collab',
  '/collab/',
  '/collab.html',
]);

function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://nodevideo.local').pathname;
  } catch {
    return '/';
  }
}

function applyBrowserFfmpegHeaders(pathname: string, response: ServerResponse): void {
  if (isolatedEditorPages.has(pathname)) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  const ffmpegClassWorker = pathname === '/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js';
  if (pathname.startsWith('/ffmpeg/0.12.10/') || ffmpegClassWorker) {
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!ffmpegClassWorker) {
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}

// ffmpeg.wasm needs same-origin core assets and cross-origin isolation for its
// pthread build. Isolation stays route-scoped because other surfaces embed
// third-party media. Production copies the same allowlisted files into dist.
function browserFfmpegAssets(): Plugin {
  const root = path.resolve(__dirname);
  const files = new Map<string, { file: string; contentType: string }>([
    [
      '/ffmpeg/0.12.10/st/ffmpeg-core.js',
      {
        file: path.join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'),
        contentType: 'text/javascript; charset=utf-8',
      },
    ],
    [
      '/ffmpeg/0.12.10/st/ffmpeg-core.wasm',
      {
        file: path.join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'),
        contentType: 'application/wasm',
      },
    ],
    [
      '/ffmpeg/0.12.10/mt/ffmpeg-core.js',
      {
        file: path.join(root, 'node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js'),
        contentType: 'text/javascript; charset=utf-8',
      },
    ],
    [
      '/ffmpeg/0.12.10/mt/ffmpeg-core.wasm',
      {
        file: path.join(root, 'node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm'),
        contentType: 'application/wasm',
      },
    ],
    [
      '/ffmpeg/0.12.10/mt/ffmpeg-core.worker.js',
      {
        file: path.join(root, 'node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js'),
        contentType: 'text/javascript; charset=utf-8',
      },
    ],
    [
      '/ffmpeg/0.12.10/Geist-Variable-Latin.ttf',
      {
        file: path.join(root, 'packs/edit-plan-renderer/assets/Geist-Variable-Latin.ttf'),
        contentType: 'font/ttf',
      },
    ],
  ]);

  return {
    name: 'nodevideo-browser-ffmpeg-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = requestPath(request.url);
        if (/^\/creator\/runs\/[^/]+\/proof\/?$/u.test(pathname)) {
          request.url = '/creator.html';
        }
        if (pathname === '/atlas' || pathname === '/atlas/') request.url = '/atlas.html';
        if (pathname === '/creatorbench' || pathname === '/creatorbench/')
          request.url = '/creatorbench.html';
        applyBrowserFfmpegHeaders(pathname, response);
        const asset = files.get(pathname);
        if (!asset || !existsSync(asset.file)) return next();
        response.setHeader('Content-Type', asset.contentType);
        createReadStream(asset.file).on('error', next).pipe(response);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = requestPath(request.url);
        if (/^\/creator\/runs\/[^/]+\/proof\/?$/u.test(pathname)) {
          request.url = '/creator.html';
        }
        if (pathname === '/atlas' || pathname === '/atlas/') request.url = '/atlas.html';
        if (pathname === '/creatorbench' || pathname === '/creatorbench/')
          request.url = '/creatorbench.html';
        applyBrowserFfmpegHeaders(pathname, response);
        next();
      });
    },
  };
}

const privatePreview =
  process.env.NODEVIDEO_LOCAL_PREVIEW ??
  path.resolve(
    __dirname,
    '.qa/evidence/private/live-product-proof/strict-render/source-only-song-preview.mp4',
  );

export default defineConfig({
  define: {
    'import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA': JSON.stringify(
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '',
    ),
  },
  optimizeDeps: {
    include: ['convex/react'],
  },
  plugins: [
    localPrivatePreview(privatePreview),
    browserFfmpegAssets(),
    react(),
    tailwindcss(),
    mediapipeWasm(),
    creatorbenchPublicEvidence(),
  ],
  publicDir: 'fixtures',
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        // The ffmpeg class worker must live under the versioned route whose
        // production COEP/CORP policy keeps it cross-origin isolated.
        entryFileNames: 'ffmpeg/0.12.10/[name]-[hash].js',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        studio: path.resolve(__dirname, 'studio.html'),
        collab: path.resolve(__dirname, 'collab.html'),
        edit: path.resolve(__dirname, 'edit.html'),
        creator: path.resolve(__dirname, 'creator.html'),
        atlas: path.resolve(__dirname, 'atlas.html'),
        creatorbench: path.resolve(__dirname, 'creatorbench.html'),
        practice: path.resolve(__dirname, 'practice.html'),
        'chrome-extension-sidepanel': path.resolve(
          __dirname,
          'apps/chrome-extension/sidepanel.html',
        ),
      },
    },
  },
  server: {
    host: true,
    port: 4173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: 'node',
    exclude: ['tests/e2e/**', '.qa/cache/**', '**/node_modules/**', '**/dist/**'],
  },
});
