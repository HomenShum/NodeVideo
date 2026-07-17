import { z } from 'zod';

const ErrorEnvelope = z.object({ error: z.string().max(1000).optional() }).passthrough();
const MAX_RESPONSE_BYTES = 512 * 1024;

export async function callControlApi<T>(args: {
  plane: 'generation' | 'evaluation';
  path: string;
  body: unknown;
  outputSchema: z.ZodType<T>;
  signal?: AbortSignal;
}): Promise<T> {
  const prefix =
    args.plane === 'generation' ? 'NODEVIDEO_GENERATION_CONTROL' : 'NODEVIDEO_EVALUATION_CONTROL';
  const baseUrl = process.env[`${prefix}_URL`];
  const token = process.env[`${prefix}_TOKEN`];
  if (!baseUrl || !token) throw new Error(`${prefix}_URL and ${prefix}_TOKEN must be configured.`);

  const endpoint = resolveEndpoint(baseUrl, args.path);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new Error('Control API response exceeds the byte limit.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new Error('Control API response exceeds the byte limit.');
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Control API returned invalid JSON.');
  }
  if (!response.ok) {
    const parsed = ErrorEnvelope.safeParse(payload);
    throw new Error(
      parsed.success && parsed.data.error
        ? parsed.data.error
        : `Control API failed with HTTP ${response.status}.`,
    );
  }
  return args.outputSchema.parse(payload);
}

function resolveEndpoint(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (base.username || base.password)
    throw new Error('Control API credentials cannot appear in a URL.');
  const host = base.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) {
    throw new Error('Control APIs require HTTPS except on localhost.');
  }
  if (!/^[a-z0-9/_-]+$/i.test(path)) throw new Error('Invalid fixed control API path.');
  base.hash = '';
  base.search = '';
  return new URL(path.replace(/^\//, ''), base);
}
