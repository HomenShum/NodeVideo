export type StageName =
  | 'validate_inputs'
  | 'ingest_reference'
  | 'normalize_media'
  | 'align_reference_song'
  | 'extract_reference_motion'
  | 'analyze_takes'
  | 'ground_subjects'
  | 'match_phrases'
  | 'plan_sequence'
  | 'place_lyrics'
  | 'compile_plan'
  | 'render_preview'
  | 'validate_preview'
  | 'await_review'
  | 'freeze'
  | 'evaluate_hidden_target';

export type JobSnapshot = {
  job: {
    _id: string;
    status: 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
    currentStage?: StageName;
    error?: string;
    frozenPlanDigest?: string;
  };
  stages: Array<{
    _id: string;
    ordinal: number;
    name: StageName;
    status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
    attempt: number;
    maxAttempts: number;
    error?: string;
    outputArtifactIds: string[];
  }>;
  artifacts: Array<{
    _id: string;
    artifactKey: string;
    kind: string;
    sha256: string;
    url?: string;
  }>;
  events: Array<{ sequence: number; kind: string; createdAt: number }>;
};

export async function controlCall<T>(token: string, path: string, body: unknown): Promise<T> {
  const base = import.meta.env.VITE_CONVEX_SITE_URL;
  if (!base) throw new Error('Live control plane is not configured.');
  const response = await fetch(`${base.replace(/\/$/, '')}/control/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(payload.error ?? `Control request failed (${response.status}).`);
  return payload;
}

export async function sha256File(file: File): Promise<`sha256:${string}`> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

export async function sha256Json(value: unknown): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export async function uploadFile(token: string, file: File): Promise<string> {
  const { uploadUrl } = await controlCall<{ uploadUrl: string }>(token, 'create-upload-url', {});
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  const payload = (await response.json()) as { storageId?: string };
  if (!payload.storageId) throw new Error('Upload did not return a storage ID.');
  return payload.storageId;
}
