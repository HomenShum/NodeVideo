import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_EDIT_EXPORT_FONT,
  compileBrowserEditPlan,
} from '../../src/lib/browser-edit-plan-compiler';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
) as unknown;

const bindings = {
  'asset.take-a': 'take-a.mp4',
  'asset.take-b': 'take-b.mp4',
};

function cloneFixture(): unknown {
  return structuredClone(fixture);
}

function mutableTracks(plan: unknown) {
  return (plan as { tracks: Array<{ kind: string; clips: Array<Record<string, unknown>> }> })
    .tracks;
}

describe('browser edit-plan compiler', () => {
  it('compiles the committed plan into a silent, fixed H.264 filter graph', () => {
    const compiled = compileBrowserEditPlan(cloneFixture(), bindings);
    const command = compiled.args.join(' ');
    const filterGraph = compiled.args[compiled.args.indexOf('-filter_complex') + 1];

    expect(compiled.inputs).toEqual([
      { assetId: 'asset.take-a', fileName: 'take-a.mp4' },
      { assetId: 'asset.take-b', fileName: 'take-b.mp4' },
    ]);
    expect(compiled.auxiliaryFiles).toHaveLength(14);
    expect(filterGraph).toContain('concat=n=7:v=1:a=0');
    expect(filterGraph).toContain('trim=end_frame=1');
    expect(filterGraph).toContain('tpad=stop_mode=clone:stop=119');
    expect(filterGraph).toContain('force_original_aspect_ratio=decrease');
    expect(filterGraph).toContain('force_original_aspect_ratio=increase');
    expect(filterGraph).toContain('0.85+0.15*min(max(n-0,0)/6,1)');
    expect(filterGraph).toContain("alpha='1*if(lt(n,1221)");
    expect(filterGraph).not.toContain('Wait a minute');
    expect(command).toContain('-an');
    expect(command).toContain('-c:v libx264');
    expect(command).not.toContain('asset.music');
    expect(compiled.fontFileName).toBe(BROWSER_EDIT_EXPORT_FONT);
    expect(compiled.manifest).toMatchObject({
      audio: 'omitted',
      overlayAnimation: 'fixed-plan-animations',
      gradeHandling: 'browser-proxy-sdr',
      videoClipCount: 7,
      textOverlayCount: 14,
    });
  });

  it('keeps arbitrary overlay text in auxiliary files, never filter syntax', () => {
    const plan = cloneFixture();
    const overlayTrack = mutableTracks(plan).find((track) => track.kind === 'overlay');
    const hostileText = "hello';movie=/secrets.mp4;[x]";
    if (!overlayTrack) throw new Error('fixture overlay track missing');
    overlayTrack.clips[0].text = hostileText;

    const compiled = compileBrowserEditPlan(plan, bindings);
    expect(compiled.args.join('\n')).not.toContain(hostileText);
    expect(compiled.auxiliaryFiles[0].data).toBe(hostileText);
  });

  it('rejects unsupported layouts and unsafe or missing bindings', () => {
    const cropPlan = cloneFixture();
    const videoTrack = mutableTracks(cropPlan).find((track) => track.kind === 'video');
    if (!videoTrack) throw new Error('fixture video track missing');
    videoTrack.clips[0].fit = 'crop';

    expect(() => compileBrowserEditPlan(cropPlan, bindings)).toThrow(/fit\/fill only/u);
    expect(() => compileBrowserEditPlan(cloneFixture(), { 'asset.take-a': 'take-a.mp4' })).toThrow(
      /Missing browser media binding for asset\.take-b/u,
    );
    expect(() =>
      compileBrowserEditPlan(cloneFixture(), {
        ...bindings,
        'asset.take-b': '../take-b.mp4',
      }),
    ).toThrow(/safe MEMFS filename/u);
  });
});
