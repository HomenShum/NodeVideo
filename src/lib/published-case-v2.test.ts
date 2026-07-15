import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type PublishedCaseV2Descriptor,
  type PublishedCaseV2Manifest,
  loadPublishedCaseV2,
} from './published-case-v2';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function makeFixture(mutate?: (manifest: PublishedCaseV2Manifest) => void): {
  assets: Map<string, string>;
  descriptor: PublishedCaseV2Descriptor;
  manifest: PublishedCaseV2Manifest;
} {
  const assets = new Map<string, string>();
  const asset = (url: string, value: string) => {
    assets.set(url, value);
    return sha256(value);
  };
  const views: PublishedCaseV2Manifest['views'] = [
    ['corrected', 'Corrected reconstruction', 9 / 16],
    ['target', 'Final target', 9 / 16],
    ['side-by-side', 'Side-by-side', 9 / 8],
    ['source-a', 'Source A', 16 / 9],
    ['source-b', 'Source B', 16 / 9],
  ].map(([id, label, ratio]) => {
    const url = `/media/v2/${id}.mp4`;
    return {
      id: id as PublishedCaseV2Manifest['views'][number]['id'],
      label: String(label),
      mimeType: 'video/mp4',
      ratio: Number(ratio),
      sha256: asset(url, `video:${id}`),
      url,
    };
  });
  const artifacts: PublishedCaseV2Manifest['artifacts'] = [
    ['edit-understanding', 'Edit understanding', 'application/json'],
    ['edit-plan', 'Edit plan', 'application/json'],
    ['otio', 'OTIO', 'application/json'],
    ['event-score-report', 'Event score report', 'application/json'],
    ['critic-report', 'Critic report', 'application/json'],
  ].map(([id, label, mimeType]) => {
    const url = `/media/v2/${id}.json`;
    return {
      id,
      label,
      mimeType,
      sha256: asset(url, `artifact:${id}`),
      url,
    };
  });
  const receiptUrl = '/media/v2/receipt.json';
  const manifest: PublishedCaseV2Manifest = {
    schemaVersion: 'nodevideo.published-case.v2',
    id: 'authorized-real-v2',
    title: 'Verified V2 fixture',
    claimBoundary: {
      demonstratedBy: ['A deterministic plan and render receipt.'],
      notClaimed: [
        'Blind source-only taste equivalence or autonomous catalog selection.',
        'Exact perceptual identity; global VMAF remains diagnostic.',
        'Decoded-render OCR or typography validation; text gates are plan-level.',
        'Commercial-track ownership or redistribution rights.',
      ],
      proven: ['Owner-authorized target-guided understanding and bounded reconstruction.'],
    },
    verdict: {
      releaseBlockers: [],
      status: 'passed',
      summary: 'All declared case-scoped plan and render gates passed.',
    },
    eventSummary: {
      grade: 'The target SDR appearance is evaluated.',
      framing: 'Fit and fill decisions are explicit.',
      passedEventCount: 42,
      picture: 'All picture events passed.',
      totalEventCount: 42,
    },
    permanentWindow: {
      endSeconds: 19.633,
      expectedSourceEndSeconds: 34.967,
      expectedSourceLabel: 'Source A',
      expectedSourceStartSeconds: 31.4,
      passed: true,
      startSeconds: 16.067,
      summary: 'The corrected source interval passed its dedicated window gate.',
    },
    soundtrack: {
      artist: 'Verified artist',
      beatMappingPassed: true,
      gainDb: -6.12,
      licenseBoundary: 'Owner-authorized target-derived fidelity asset.',
      outputEndSeconds: 40.339,
      outputStartSeconds: 0,
      referenceOffsetSeconds: 29.146,
      sourceAudioMuted: true,
      summary: 'The declared target-audio correlation and lag gates passed.',
      title: 'Verified soundtrack',
    },
    textSummary: {
      cueCount: 31,
      passed: true,
      summary:
        'All 31 typed plan cues passed content and timing checks; decoded OCR is not scored.',
    },
    pictureClips: [
      ['a-1', 'A fit', 0, 6.7, 'Source A', 'fit'],
      ['b-1', 'B fill', 6.7, 16.067, 'Source B', 'fill'],
      ['a-2', 'A fit corrected', 16.067, 19.633, 'Source A', 'fit'],
      ['b-2', 'B fill', 19.633, 25.1, 'Source B', 'fill'],
      ['a-3', 'A fit', 25.1, 40.467, 'Source A', 'fit'],
      ['tail', 'Transition and end card', 40.467, 44.5, 'Source A', 'freeze'],
    ].map(([id, label, outputStartSeconds, outputEndSeconds, sourceLabel, framing]) => ({
      framing: framing as PublishedCaseV2Manifest['pictureClips'][number]['framing'],
      id: String(id),
      label: String(label),
      outputEndSeconds: Number(outputEndSeconds),
      outputStartSeconds: Number(outputStartSeconds),
      passed: true,
      sourceLabel: String(sourceLabel),
    })),
    views,
    artifacts,
    receiptSha256: asset(receiptUrl, 'receipt'),
    receiptUrl,
    v1AdjudicationUrl: '/media/authorized-real-v1/adjudication-v2.json',
  };
  mutate?.(manifest);
  const manifestUrl = '/media/authorized-real-v2/manifest.json';
  const manifestJson = JSON.stringify(manifest);
  assets.set(manifestUrl, manifestJson);
  return {
    assets,
    descriptor: {
      id: 'authorized-real-v2',
      manifestSha256: sha256(manifestJson),
      manifestUrl,
      title: 'V2 fixture',
    },
    manifest,
  };
}

function fixtureFetcher(assets: Map<string, string>, calls: string[] = []) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const value = assets.get(url);
    return value === undefined ? new Response('missing', { status: 404 }) : new Response(value);
  };
}

describe('published V2 case loader', () => {
  it('verifies the trusted manifest before every declared view, artifact, and receipt', async () => {
    const fixture = makeFixture();
    const calls: string[] = [];
    const loaded = await loadPublishedCaseV2(
      fixture.descriptor,
      fixtureFetcher(fixture.assets, calls),
    );

    expect(calls[0]).toBe(fixture.descriptor.manifestUrl);
    expect(calls).toHaveLength(12);
    expect(loaded.integrity).toMatchObject({ verified: true, verifiedAssetCount: 11 });
    expect(loaded.releasePassed).toBe(true);
    expect(loaded.manifest.views[0].id).toBe('corrected');
  });

  it('fails closed before fetching anything when no trusted digest is configured', async () => {
    const fixture = makeFixture();
    const calls: string[] = [];

    await expect(
      loadPublishedCaseV2(
        { ...fixture.descriptor, manifestSha256: '' },
        fixtureFetcher(fixture.assets, calls),
      ),
    ).rejects.toThrow(/trusted V2 manifest digest is not configured/i);
    expect(calls).toEqual([]);
  });

  it('rejects a trusted manifest that claims pass while the soundtrack gate fails', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.soundtrack.beatMappingPassed = false;
    });

    await expect(
      loadPublishedCaseV2(fixture.descriptor, fixtureFetcher(fixture.assets)),
    ).rejects.toThrow(/claims pass.*release gates are blocked/i);
  });

  it('names a tampered proof asset and never returns a partial pass', async () => {
    const fixture = makeFixture();
    fixture.assets.set('/media/v2/corrected.mp4', 'tampered');

    await expect(
      loadPublishedCaseV2(fixture.descriptor, fixtureFetcher(fixture.assets)),
    ).rejects.toThrow(/corrected reconstruction failed SHA-256 verification/i);
  });

  it('rejects cross-origin asset paths even when the manifest digest is trusted', async () => {
    const fixture = makeFixture((manifest) => {
      manifest.views[0].url = 'https://example.com/corrected.mp4';
    });

    await expect(
      loadPublishedCaseV2(fixture.descriptor, fixtureFetcher(fixture.assets)),
    ).rejects.toThrow(/same-origin public path/i);
  });
});
