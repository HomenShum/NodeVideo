import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { localPrivatePreview } from './scripts/dev/local-private-preview';

const privatePreview =
  process.env.NODEVIDEO_LOCAL_PREVIEW ??
  path.resolve(
    __dirname,
    '.qa/evidence/private/live-product-proof/strict-render/source-only-song-preview.mp4',
  );

export default defineConfig({
  plugins: [localPrivatePreview(privatePreview), react(), tailwindcss()],
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
