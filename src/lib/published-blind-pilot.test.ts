import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type PublishedBlindPilotDescriptor,
  type PublishedBlindPilotManifest,
  loadPublishedBlindPilot,
} from './published-blind-pilot';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function makeFixture(mutate?: (manifest: PublishedBlindPilotManifest) => void) {
  const assets = new Map<string, string>();
  const asset = (url: string, body: string) => {
    assets.set(url, body);
    return sha256(body);
  };
  const base = '/media/blind-source-only-pilot-01';
  const artifacts: PublishedBlindPilotManifest['artifacts'] = [
    ['edit-plan', 'Edit plan', 'edit-plan.json'],
    ['music-handoff', 'Music handoff', 'music-handoff.json'],
    ['rationale', 'Creative rationale', 'rationale.md'],
    ['read-log', 'Read log', 'read-log.json'],
    ['freeze', 'Freeze receipt', 'freeze.json'],
    ['held-out-evaluation', 'Held-out evaluation', 'held-out-evaluation.json'],
    ['held-out-comparison', 'Held-out comparison', 'held-out-comparison.mp4'],
    ['redaction-receipt', 'Redaction receipt', 'redaction-receipt.json'],
  ].map(([id, label, name]) => {
    const url = `${base}/${name}`;
    return {
      id: id as PublishedBlindPilotManifest['artifacts'][number]['id'],
      label,
      mimeType: name.endsWith('.mp4') ? 'video/mp4' : 'application/json',
      sha256: asset(url, `artifact:${id}`),
      url,
    };
  });
  const previewUrl = `${base}/source-only-preview.mp4`;
  const manifest: PublishedBlindPilotManifest = {
    schemaVersion: 'nodevideo.blind-source-only-pilot.v1',
    id: 'blind-source-only-pilot-01',
    title: 'Blind source-only fixture',
    protocol: {
      freshPlannerContext: true,
      frozenAt: '2026-07-15T12:00:00.000Z',
      publicCatalogAllowed: true,
      sourceInputSha256: [sha256('source-a'), sha256('source-b')],
      targetAccessDuringGeneration: false,
      targetMountedDuringGeneration: false,
    },
    verdict: {
      limitations: ['One case cannot establish generalized taste.'],
      protocolStatus: 'passed',
      summary: 'The plan was frozen before held-out evaluation.',
      tasteEvidenceRef: null,
      tasteStatus: 'awaiting-blinded-human-evaluation',
    },
    claimBoundary: {
      notClaimed: ['General creative superiority or music licensing.'],
      proven: ['A target-isolated source-only generation protocol for this pilot.'],
    },
    preview: {
      audioPolicy: 'commercial-music-absent',
      durationSeconds: 20,
      height: 1920,
      mimeType: 'video/mp4',
      ratio: 9 / 16,
      sha256: asset(previewUrl, 'preview'),
      url: previewUrl,
      width: 1080,
    },
    musicHandoff: {
      anchors: [
        { id: 'a', label: 'Open', referenceSeconds: 30, videoSeconds: 0 },
        { id: 'b', label: 'Lift', referenceSeconds: 40, videoSeconds: 10 },
      ],
      artist: 'Candidate artist',
      availabilityStatus: 'confirm-in-instagram',
      commercialAudioPublished: false,
      rationale: 'The pulse follows source motion.',
      searchQuery: 'Candidate title Candidate artist',
      referenceBasis: 'full-track-timestamp',
      referenceCue: 'first chorus downbeat',
      referenceDurationSeconds: 180,
      referenceEndSeconds: 50,
      referenceStartSeconds: 30,
      title: 'Candidate title',
    },
    instagramHandoff: {
      steps: [
        'Download clean edit.',
        'Find the track.',
        'Set the segment.',
        'Align the first beat.',
      ],
      userAddsAudioInInstagram: true,
    },
    artifacts,
  };
  mutate?.(manifest);
  const manifestUrl = `${base}/manifest.json`;
  const body = JSON.stringify(manifest);
  assets.set(manifestUrl, body);
  const descriptor: PublishedBlindPilotDescriptor = {
    id: 'blind-source-only-pilot-01',
    manifestSha256: sha256(body),
    manifestUrl,
    title: 'Blind pilot fixture',
  };
  return { assets, descriptor };
}

const fetcher =
  (assets: Map<string, string>, calls: string[] = []) =>
  async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = assets.get(url);
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
  };

describe('published blind source-only pilot loader', () => {
  it('verifies the trusted manifest, preview, and every frozen artifact', async () => {
    const fixture = makeFixture();
    const calls: string[] = [];
    const loaded = await loadPublishedBlindPilot(
      fixture.descriptor,
      fetcher(fixture.assets, calls),
    );
    expect(calls[0]).toBe(fixture.descriptor.manifestUrl);
    expect(calls).toHaveLength(10);
    expect(loaded.protocolPassed).toBe(true);
    expect(loaded.integrity.verifiedAssetCount).toBe(9);
    expect(loaded.manifest.verdict.tasteStatus).toBe('awaiting-blinded-human-evaluation');
  });

  it('fails before fetching when the deployment trust anchor is absent', async () => {
    const fixture = makeFixture();
    const calls: string[] = [];
    await expect(
      loadPublishedBlindPilot(
        { ...fixture.descriptor, manifestSha256: '' },
        fetcher(fixture.assets, calls),
      ),
    ).rejects.toThrow(/trusted blind-pilot manifest digest is not configured/i);
    expect(calls).toEqual([]);
  });

  it('rejects a pass when target access was allowed during generation', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.protocol.targetAccessDuringGeneration = true as false;
    });
    await expect(
      loadPublishedBlindPilot(fixture.descriptor, fetcher(fixture.assets)),
    ).rejects.toThrow(/blind source-only proof contract/i);
  });

  it('rejects a blocked protocol instead of exposing its proof assets', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.verdict.protocolStatus = 'blocked';
    });
    await expect(
      loadPublishedBlindPilot(fixture.descriptor, fetcher(fixture.assets)),
    ).rejects.toThrow(/blind source-only proof contract/i);
  });

  it('requires the exact unique artifact bundle and paths', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.artifacts[7].id = 'edit-plan';
      manifest.artifacts[7].url = manifest.artifacts[0].url;
    });
    await expect(
      loadPublishedBlindPilot(fixture.descriptor, fetcher(fixture.assets)),
    ).rejects.toThrow(/blind source-only proof contract/i);
  });

  it('rejects cue anchors that do not preserve the selected preview-reference offset', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.musicHandoff.anchors[1].referenceSeconds = 41;
    });
    await expect(
      loadPublishedBlindPilot(fixture.descriptor, fetcher(fixture.assets)),
    ).rejects.toThrow(/blind source-only proof contract/i);
  });

  it('requires evidence before reporting a blinded taste evaluation', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.verdict.tasteStatus = 'evaluated-blinded';
    });
    await expect(
      loadPublishedBlindPilot(fixture.descriptor, fetcher(fixture.assets)),
    ).rejects.toThrow(/blind source-only proof contract/i);
  });

  it('rejects cross-origin evidence even when its hash is trusted', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.artifacts[0].url = 'https://example.com/edit-plan.json';
    });
    await expect(
      loadPublishedBlindPilot(fixture.descriptor, fetcher(fixture.assets)),
    ).rejects.toThrow(/same-origin public path/i);
  });
});
