import { type AssetReceipt, publicReleaseEligible } from './asset-receipts';

export const SHOWCASE_MANIFEST_SCHEMA = 'node.showcase-manifest.v1' as const;

export type ShowcaseArtifact = {
  id: string;
  role: 'hero' | 'feature' | 'architecture' | 'proof' | 'social' | 'interactive';
  kind: 'mp4' | 'gif' | 'image' | 'glb' | 'gaussian-splat' | 'html';
  receipt: AssetReceipt;
  previewUri?: string;
  interactiveUri?: string;
  alt: string;
};

export type ShowcaseManifest = {
  schemaVersion: typeof SHOWCASE_MANIFEST_SCHEMA;
  id: string;
  title: string;
  summary: string;
  repository: string;
  sourceCommit: string;
  publicUrl?: string;
  artifacts: ShowcaseArtifact[];
  proof: {
    testSummary: string;
    receiptUris: string[];
    limitations: string[];
  };
};

export function validateShowcaseManifest(manifest: ShowcaseManifest): ShowcaseManifest {
  if (manifest.schemaVersion !== SHOWCASE_MANIFEST_SCHEMA)
    throw new Error('Showcase schema is unsupported');
  if (!manifest.id || !manifest.title || !manifest.repository)
    throw new Error('Showcase identity is required');
  if (!/^[a-f\d]{7,64}$/u.test(manifest.sourceCommit))
    throw new Error('Showcase source commit is invalid');
  if (manifest.artifacts.length === 0) throw new Error('Showcase requires an artifact');
  const ids = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (ids.has(artifact.id)) throw new Error(`Duplicate showcase artifact: ${artifact.id}`);
    ids.add(artifact.id);
    if (!artifact.alt.trim()) throw new Error(`${artifact.id} requires alternative text`);
    if (!publicReleaseEligible(artifact.receipt))
      throw new Error(`${artifact.id} is not approved for public release`);
    if (
      (artifact.kind === 'glb' || artifact.kind === 'gaussian-splat') &&
      !artifact.interactiveUri
    ) {
      throw new Error(`${artifact.id} requires an interactive viewer URI`);
    }
  }
  return manifest;
}
