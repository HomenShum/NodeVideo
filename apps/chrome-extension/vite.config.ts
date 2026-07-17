import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  publicDir: 'public',
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { input: path.resolve(__dirname, 'sidepanel.html') },
  },
});
