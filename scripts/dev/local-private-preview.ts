import { createReadStream, existsSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';

export const LOCAL_PREVIEW_ROUTE = '/__nodevideo_local/full-preview.mp4';

export function localPrivatePreview(filePath: string): Plugin {
  return {
    name: 'nodevideo-local-private-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== LOCAL_PREVIEW_ROUTE) return next();
        if (!existsSync(filePath) || !['GET', 'HEAD'].includes(request.method ?? '')) {
          response.statusCode = 404;
          response.end('Local private preview unavailable.');
          return;
        }
        const size = statSync(filePath).size;
        const range = parseRange(request.headers.range, size);
        if (request.headers.range && !range) {
          response.writeHead(416, { 'Content-Range': `bytes */${size}` });
          response.end();
          return;
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? size - 1;
        const headers: Record<string, string | number> = {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-store',
          'Content-Length': end - start + 1,
          'Content-Type': 'video/mp4',
          'Cross-Origin-Resource-Policy': 'same-origin',
        };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        response.writeHead(range ? 206 : 200, headers);
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(filePath, { end, start }).pipe(response);
      });
    },
  };
}

function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const requestedStart = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const requestedEnd = match[2] && match[1] ? Number(match[2]) : size - 1;
  const start = Math.max(0, requestedStart);
  const end = Math.min(size - 1, requestedEnd);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end
    ? { end, start }
    : null;
}
