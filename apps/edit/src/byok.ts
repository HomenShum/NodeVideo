// Bring-your-own-key, session-only. The key lives in sessionStorage (cleared
// when the tab closes), is never sent anywhere but the chosen provider from
// the user's own browser, and never touches a NodeVideo server. Mirrors
// NodeSlide's sessionByok. OpenRouter is the default because it is CORS-open
// for browser use and gateways many models (incl. Claude) behind one key.

const KEY_STORAGE = 'nodevideo.byok.OPENROUTER_API_KEY';
const MODEL_STORAGE = 'nodevideo.byok.MODEL';
export const DEFAULT_MODEL = 'anthropic/claude-opus-4-8';

export function readByokKey(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(KEY_STORAGE) ?? '';
}

export function writeByokKey(value: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = value.trim();
  if (trimmed) window.sessionStorage.setItem(KEY_STORAGE, trimmed);
  else window.sessionStorage.removeItem(KEY_STORAGE);
}

export function readByokModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL;
  return window.sessionStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
}

export function writeByokModel(value: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = value.trim();
  if (trimmed) window.sessionStorage.setItem(MODEL_STORAGE, trimmed);
  else window.sessionStorage.removeItem(MODEL_STORAGE);
}

export function maskKey(value: string): string {
  if (!value) return 'not set';
  return value.length <= 4 ? 'set' : `•••• ${value.slice(-4)}`;
}
