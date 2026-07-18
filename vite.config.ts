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

const privatePreview =
  process.env.NODEVIDEO_LOCAL_PREVIEW ??
  path.resolve(
    __dirname,
    '.qa/evidence/private/live-product-proof/strict-render/source-only-song-preview.mp4',
  );

export default defineConfig({
  plugins: [localPrivatePreview(privatePreview), react(), tailwindcss(), mediapipeWasm()],
  publicDir: 'fixtures',
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
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
