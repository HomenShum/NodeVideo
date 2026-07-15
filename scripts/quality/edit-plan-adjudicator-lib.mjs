import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const PLAN_ADJUDICATOR_VERSION = 'nodevideo.plan-adjudicator@1.2.0';
export const EVENT_SCORE_REPORT_VERSION = 'nodevideo.event-score-report.v2';
export const CRITIC_REPORT_VERSION = 'nodevideo.critic-report.v2';
export const RENDER_METRICS_VERSION = 'nodevideo.render-metrics.v1';
export const MINIMUM_PERMANENT_WINDOW_SCORE = 0.9;
export const MINIMUM_ANY_WINDOW_SCORE = 0.85;
export const RELEASE_READINESS_SCOPE = 'technical-reconstruction-of-authorized-reference-case';

const groundTruthPath = resolve(
  import.meta.dirname,
  '../../packs/reference-reconstruct/evals/authorized-real-v2-ground-truth.json',
);
const groundTruth = JSON.parse(readFileSync(groundTruthPath, 'utf8'));

if (
  groundTruth.schema !== 'nodevideo.reference-ground-truth.v2' ||
  groundTruth.visibility !== 'evaluator-only'
) {
  throw new Error('The evaluator-only V2 ground truth is unavailable or has an unsupported schema');
}

/**
 * Evaluator-only comparison of a canonical EditPlan with the withheld V2 reference decisions.
 * This module is intentionally kept outside analyzer, planner, renderer, critic, and app source.
 *
 * @param {unknown} planInput
 * @param {unknown | undefined | null} renderMetricsInput
 * @param {{createdAt?: string}} [options]
 */
export function adjudicateEditPlan(planInput, renderMetricsInput, options = {}) {
  const plan = asRecord(planInput, 'EditPlan');
  const events = [];
  const add = (event) => events.push(normalizeEvent(event));
  const primary = findPrimaryTrack(plan);
  const primaryClips = Array.isArray(primary?.clips) ? primary.clips : [];
  const expectedVideo = groundTruth.video;

  add({
    id: 'plan-schema',
    category: 'technical',
    pass:
      plan.schemaVersion === 'nodevideo.edit-plan.v1' &&
      plan.frameRate === expectedVideo.frameRate &&
      plan.canvas?.width === expectedVideo.width &&
      plan.canvas?.height === expectedVideo.height &&
      plan.durationFrames === expectedVideo.durationFrames &&
      primary != null,
    expected: {
      schemaVersion: 'nodevideo.edit-plan.v1',
      frameRate: expectedVideo.frameRate,
      canvas: { width: expectedVideo.width, height: expectedVideo.height },
      durationFrames: expectedVideo.durationFrames,
      primaryTrack: true,
    },
    observed: {
      schemaVersion: plan.schemaVersion,
      frameRate: plan.frameRate,
      canvas: plan.canvas,
      durationFrames: plan.durationFrames,
      primaryTrack: primary != null,
    },
    message: 'Plan schema, canvas, rate, duration, and primary track must match the reference.',
  });

  const observedCuts = primaryClips.slice(1).map((clip) => clip?.timelineRange?.startFrame);
  add({
    id: 'video-cuts',
    category: 'mapping',
    pass: sameArray(observedCuts, expectedVideo.cutFrames),
    expected: expectedVideo.cutFrames,
    observed: observedCuts,
    message: 'Every cut must land on the exact withheld reference frame.',
  });

  for (const [index, expected] of expectedVideo.clips.entries()) {
    const observed = primaryClips[index];
    const checks = compareVideoClip(observed, expected, groundTruth.releaseGates);
    add({
      id: `video-clip:${expected.id}`,
      category: 'mapping',
      pass: checks.every(Boolean),
      score: fractionPassing(checks),
      permanent: expected.permanentRegression === true,
      timelineRange: expected.timelineRange,
      expected: summarizeVideoClip(expected),
      observed: summarizeVideoClip(observed),
      message: expected.permanentRegression
        ? 'The permanent 482–589 regression window must use the corrected Source A phrase.'
        : `Video decision ${expected.id} must match kind, source identity, mapping, and layout.`,
    });
  }
  add({
    id: 'video-clip-count',
    category: 'mapping',
    pass: primaryClips.length === expectedVideo.clips.length,
    expected: expectedVideo.clips.length,
    observed: primaryClips.length,
    message: 'The primary picture decision list must not omit or add clips.',
  });

  evaluateAudio(plan, add);
  evaluateText(plan, add);
  evaluateSocial(plan, add);
  evaluateRenderMetrics(renderMetricsInput, plan, add);

  const failedEvents = events.filter((event) => !event.pass);
  const createdAt = normalizeTimestamp(options.createdAt ?? new Date().toISOString());
  const renderArtifactId = renderArtifactIdFor(plan, renderMetricsInput);
  const findings = failedEvents.map((event) => eventFinding(event, renderArtifactId));
  const findingIdsByEventId = new Map(
    failedEvents.map((event, index) => [event.id, findings[index].id]),
  );
  const worstWindows = failedEvents
    .filter((event) => event.timelineRange != null)
    .map((event) => ({
      timelineRange: event.timelineRange,
      score: event.score,
      metric: criticMetric(event.category),
      findingIds: [findingIdsByEventId.get(event.id)],
    }));
  const scores = criticScores(events);
  const passed = failedEvents.length === 0;
  const criticReport = {
    schemaVersion: CRITIC_REPORT_VERSION,
    id: `critic:${safeId(plan.id ?? 'unknown')}:v${positiveInteger(plan.version, 1)}`,
    planId: nonEmptyString(plan.id, 'unknown-plan'),
    planVersion: positiveInteger(plan.version, 1),
    renderArtifactId,
    createdAt,
    mode: 'deterministic',
    verdict: passed ? 'pass' : 'fail',
    scores,
    tasteStatus: 'not-evaluated',
    findings,
    worstWindows,
    patches: [],
  };
  const eventScoreReport = {
    schemaVersion: EVENT_SCORE_REPORT_VERSION,
    evaluatorVersion: PLAN_ADJUDICATOR_VERSION,
    groundTruthId: groundTruth.id,
    planId: criticReport.planId,
    planVersion: criticReport.planVersion,
    renderArtifactId,
    renderMetricsProvided: renderMetricsInput != null,
    scope: renderMetricsInput == null ? 'plan-only' : 'plan-and-render',
    passed,
    releaseReady: passed && renderMetricsInput != null,
    releaseReadyScope: RELEASE_READINESS_SCOPE,
    summary: {
      total: events.length,
      passed: events.length - failedEvents.length,
      failed: failedEvents.length,
      score: average(events.map((event) => event.score)),
      permanentFailure: failedEvents.some((event) => event.permanent),
    },
    releaseBlockers: failedEvents.map((event) => event.id),
    events,
  };
  return { criticReport, eventScoreReport };
}

function evaluateAudio(plan, add) {
  const expected = groundTruth.audio;
  const program = isRecord(plan.audio) ? plan.audio : {};
  const routes = Array.isArray(program.routing) ? program.routing : [];
  const audioEvents = Array.isArray(program.events) ? program.events : [];
  const audioClips = allTracks(plan, 'audio').flatMap((track) =>
    Array.isArray(track.clips) ? track.clips : [],
  );
  const sourceAssetIds = [
    ...new Set(
      groundTruth.video.clips.filter((clip) => clip.kind === 'source').map((clip) => clip.assetId),
    ),
  ];
  const routeStates = sourceAssetIds.map((assetId) => ({
    assetId,
    muted: routes.some(
      (route) =>
        route?.sourceKind === 'asset-audio' && route?.sourceId === assetId && route?.muted === true,
    ),
  }));
  add({
    id: 'audio-source-routing',
    category: 'audio',
    pass: expected.sourceAudioMode === 'muted' && routeStates.every((state) => state.muted),
    expected: { mode: 'muted', assetIds: sourceAssetIds },
    observed: routeStates,
    message: 'Embedded audio from every source video must be explicitly muted.',
  });

  const musicEvent = audioEvents.find((event) => event?.kind === 'music');
  const musicClip = audioClips.find((clip) => clip?.id === musicEvent?.clipId);
  const expectedMusic = expected.music;
  const identity = musicEvent?.identity;
  add({
    id: 'audio-music-identity',
    category: 'audio',
    pass:
      normalizedText(identity?.title) === normalizedText(expectedMusic.title) &&
      normalizedText(identity?.artist) === normalizedText(expectedMusic.artist) &&
      String(identity?.isrc ?? '').toUpperCase() === expectedMusic.isrc,
    expected: {
      title: expectedMusic.title,
      artist: expectedMusic.artist,
      isrc: expectedMusic.isrc,
    },
    observed: identity ?? null,
    timelineRange: millisecondsToFrameRange(
      expectedMusic.targetRangeMs.start,
      expectedMusic.targetRangeMs.end,
    ),
    message: 'The selected soundtrack must identify the correct released master.',
  });
  const musicAssetIsTargetDerived = Array.isArray(plan.lineage?.targetDerivedRenderAssetIds)
    ? plan.lineage.targetDerivedRenderAssetIds.includes(musicClip?.assetId)
    : false;
  const clipLocalOffsetMs = Number.isFinite(musicClip?.sourceRange?.startFrame)
    ? (musicClip.sourceRange.startFrame / plan.frameRate) * 1_000
    : Number.NaN;
  const localOffsetChecks = [
    within(musicEvent?.sourceOffsetMs, clipLocalOffsetMs, 1_000 / plan.frameRate),
    !musicAssetIsTargetDerived || within(musicEvent?.sourceOffsetMs, 0, 1),
  ];
  const excerptChecks = [
    ...localOffsetChecks,
    within(musicEvent?.releasedMasterOffsetMs, expectedMusic.releasedMasterOffsetMs, 1),
    within(musicEvent?.targetStartMs, expectedMusic.targetRangeMs.start, 1),
    within(musicEvent?.targetEndMs, expectedMusic.targetRangeMs.end, 1),
    within(musicClip?.playbackRate, expectedMusic.playbackRate, 1e-6),
  ];
  add({
    id: 'audio-music-excerpt',
    category: 'audio',
    pass: excerptChecks.every(Boolean),
    score: fractionPassing(excerptChecks),
    expected: {
      sourceOffsetMs: musicAssetIsTargetDerived ? 0 : clipLocalOffsetMs,
      releasedMasterOffsetMs: expectedMusic.releasedMasterOffsetMs,
      targetStartMs: expectedMusic.targetRangeMs.start,
      targetEndMs: expectedMusic.targetRangeMs.end,
      playbackRate: expectedMusic.playbackRate,
    },
    observed: musicEvent
      ? {
          sourceOffsetMs: musicEvent.sourceOffsetMs,
          releasedMasterOffsetMs: musicEvent.releasedMasterOffsetMs,
          targetStartMs: musicEvent.targetStartMs,
          targetEndMs: musicEvent.targetEndMs,
          playbackRate: musicClip?.playbackRate,
        }
      : null,
    timelineRange: millisecondsToFrameRange(
      expectedMusic.targetRangeMs.start,
      expectedMusic.targetRangeMs.end,
    ),
    message:
      'Asset-local trim, released-master provenance, and sample-time target window must remain distinct and match the reference.',
  });
  add({
    id: 'audio-music-gain',
    category: 'audio',
    pass:
      within(musicEvent?.gainDb, musicAssetIsTargetDerived ? 0 : expectedMusic.gainDb, 0.05) &&
      within(musicClip?.gainDb, musicAssetIsTargetDerived ? 0 : expectedMusic.gainDb, 0.05) &&
      within(musicEvent?.releasedMasterGainDb, expectedMusic.gainDb, 0.05),
    expected: {
      renderGainDb: musicAssetIsTargetDerived ? 0 : expectedMusic.gainDb,
      releasedMasterGainDb: expectedMusic.gainDb,
    },
    observed: {
      eventGainDb: musicEvent?.gainDb,
      clipGainDb: musicClip?.gainDb,
      releasedMasterGainDb: musicEvent?.releasedMasterGainDb,
    },
    timelineRange: millisecondsToFrameRange(
      expectedMusic.targetRangeMs.start,
      expectedMusic.targetRangeMs.end,
    ),
    message:
      'Render-local gain must not re-attenuate an extracted target mix; released-master gain remains provenance.',
  });
  add({
    id: 'audio-target-derivation-authorization',
    category: 'lineage',
    pass:
      musicClip?.license?.status === 'target-derived-authorized' &&
      typeof musicClip?.license?.proofRef === 'string' &&
      musicClip.license.proofRef.trim().length > 0,
    expected: { status: 'target-derived-authorized', proofRef: 'non-empty' },
    observed: musicClip?.license ?? null,
    message: 'Reference soundtrack fidelity requires explicit target-derived authorization.',
  });

  const expectedSilence = expected.events.filter((event) => event.kind === 'silence');
  const observedSilence = audioEvents.filter((event) => event?.kind === 'silence');
  add({
    id: 'audio-silence-events',
    category: 'audio',
    pass:
      observedSilence.length === expectedSilence.length &&
      expectedSilence.every(
        (event, index) =>
          within(observedSilence[index]?.targetStartMs, event.startMs, 1) &&
          within(observedSilence[index]?.targetEndMs, event.endMs, 1),
      ),
    expected: expectedSilence,
    observed: observedSilence.map((event) => ({
      startMs: event.targetStartMs,
      endMs: event.targetEndMs,
    })),
    timelineRange: millisecondsToFrameRange(
      expectedSilence[0].startMs,
      expectedSilence.at(-1).endMs,
    ),
    message: 'Both intentional silence windows must be represented at sample-time precision.',
  });
  const expectedSting = expected.events.find((event) => event.kind === 'end-sting');
  const stingEvent = audioEvents.find((event) => event?.kind === 'sting');
  const stingClip = audioClips.find((clip) => clip?.id === stingEvent?.clipId);
  add({
    id: 'audio-end-sting',
    category: 'audio',
    pass:
      within(stingEvent?.targetStartMs, expectedSting.startMs, 1) &&
      within(stingEvent?.targetEndMs, expectedSting.endMs, 1) &&
      stingClip?.role === 'sting',
    expected: expectedSting,
    observed: stingEvent
      ? {
          kind: stingEvent.kind,
          startMs: stingEvent.targetStartMs,
          endMs: stingEvent.targetEndMs,
          clipRole: stingClip?.role,
        }
      : null,
    timelineRange: millisecondsToFrameRange(expectedSting.startMs, expectedSting.endMs),
    message: 'The end sting must remain distinct from music, SFX, and silence.',
  });
  add({
    id: 'audio-event-count',
    category: 'audio',
    pass: audioEvents.length === expected.events.length + 1,
    expected: expected.events.length + 1,
    observed: audioEvents.length,
    message:
      'The audio program must contain one music event and exactly the reference tail events.',
  });
}

function evaluateText(plan, add) {
  const expectedCues = groundTruth.textCues;
  const textClips = allTracks(plan, 'overlay')
    .flatMap((track) => (Array.isArray(track.clips) ? track.clips : []))
    .filter((clip) => clip?.kind === 'text')
    .sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  add({
    id: 'text-cue-count',
    category: 'text',
    pass: textClips.length === expectedCues.length,
    expected: expectedCues.length,
    observed: textClips.length,
    message: 'All 31 timed text cues are release-blocking.',
  });
  const tolerance = groundTruth.releaseGates.textTimingToleranceFrames;
  for (const [index, expected] of expectedCues.entries()) {
    const observed = textClips[index];
    const checks = [
      normalizedText(observed?.text) === normalizedText(expected.text),
      within(observed?.timelineRange?.startFrame, expected.startFrame, tolerance),
      within(observed?.timelineRange?.endFrameExclusive, expected.endFrameExclusive, tolerance),
    ];
    add({
      id: `text-cue:${String(index + 1).padStart(2, '0')}`,
      category: 'text',
      pass: checks.every(Boolean),
      score: fractionPassing(checks),
      timelineRange: {
        startFrame: expected.startFrame,
        endFrameExclusive: expected.endFrameExclusive,
      },
      expected,
      observed: observed
        ? {
            startFrame: observed.timelineRange?.startFrame,
            endFrameExclusive: observed.timelineRange?.endFrameExclusive,
            text: observed.text,
          }
        : null,
      message: `Text cue ${index + 1} must match content and timing within ±${tolerance} frames.`,
    });
  }
}

function evaluateSocial(plan, add) {
  const overlayClips = allTracks(plan, 'overlay')
    .flatMap((track) => (Array.isArray(track.clips) ? track.clips : []))
    .filter((clip) => clip?.kind === 'graphic');
  const socialClips = overlayClips
    .filter(
      (clip) =>
        (typeof clip?.templateId === 'string' && clip.templateId.startsWith('social.')) ||
        String(clip?.id ?? '').startsWith('overlay.social-') ||
        String(clip?.id ?? '') === 'overlay.end-card-brand',
    )
    .sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  if (socialClips.length === 0) {
    add({
      id: 'social-overlay-timing:not-represented',
      category: 'framing',
      pass: true,
      expected: 'Gate applies when social.* overlay phases are represented by the plan.',
      observed: 'not represented',
      message: 'Social-layer phase evaluation is not applicable to this plan.',
    });
    return;
  }
  const observed = socialClips.map((clip) => ({
    startFrame: clip.timelineRange?.startFrame,
    endFrameExclusive: clip.timelineRange?.endFrameExclusive,
    state: socialStateForClip(clip),
  }));
  const expected = groundTruth.socialLayer.filter(
    (phase) => !['absent', 'transition'].includes(phase.state),
  );
  add({
    id: 'social-overlay-timing:visible-phases',
    category: 'framing',
    pass:
      observed.length === expected.length &&
      expected.every(
        (phase, index) =>
          observed[index]?.startFrame === phase.startFrame &&
          observed[index]?.endFrameExclusive === phase.endFrameExclusive &&
          observed[index]?.state === phase.state,
      ),
    expected,
    observed,
    timelineRange: { startFrame: 0, endFrameExclusive: groundTruth.video.durationFrames },
    message:
      'Social-layer presence and position phases must match; gradient and transition styling remain approximate.',
  });
}

function socialStateForClip(clip) {
  const id = String(clip?.id ?? '');
  if (id.includes('end-card')) return 'end-card-animated';
  if (id.includes('social-top')) return 'top-right';
  if (id.includes('social-left')) return 'lower-left';
  return String(clip?.templateId ?? '').replace(/^social\./u, '');
}

function evaluateRenderMetrics(input, plan, add) {
  if (input == null) {
    add({
      id: 'render-metrics:not-provided',
      category: 'technical',
      pass: true,
      expected: 'Optional for plan-only adjudication',
      observed: null,
      message: 'No render metrics were supplied; audiovisual metric gates were not evaluated.',
    });
    return;
  }
  const metrics = normalizeRenderMetrics(
    input,
    plan.frameRate ?? groundTruth.video.frameRate,
    plan.durationFrames ?? groundTruth.video.durationFrames,
  );
  const permanentRange = groundTruth.releaseGates.permanentRegressionRange;
  const permanentWindow = metrics.windows.find((window) =>
    contains(window.timelineRange, permanentRange),
  );
  add({
    id: 'render-window:permanent-regression',
    category: 'technical',
    pass: permanentWindow != null && permanentWindow.score >= MINIMUM_PERMANENT_WINDOW_SCORE,
    expected: {
      timelineRange: permanentRange,
      minimumScore: MINIMUM_PERMANENT_WINDOW_SCORE,
      globalAverageCannotOverride: true,
    },
    observed: {
      window: permanentWindow ?? null,
      global: metrics.global,
    },
    timelineRange: permanentRange,
    permanent: true,
    score: permanentWindow?.score ?? 0,
    message: 'The 482–589 worst window must pass independently of every global average.',
  });
  const worst = metrics.windows.reduce(
    (current, window) => (current == null || window.score < current.score ? window : current),
    null,
  );
  add({
    id: 'render-window:worst',
    category: 'technical',
    pass: worst != null && worst.score >= MINIMUM_ANY_WINDOW_SCORE,
    expected: { minimumScore: MINIMUM_ANY_WINDOW_SCORE },
    observed: worst,
    timelineRange: worst?.timelineRange,
    score: worst?.score ?? 0,
    message: 'No local render window may be hidden by a passing global average.',
  });
  add({
    id: 'render-audio:reference-correlation',
    category: 'audio',
    pass: metrics.audio.referenceCorrelation >= groundTruth.audio.minimumReferenceCorrelation,
    expected: { minimum: groundTruth.audio.minimumReferenceCorrelation },
    observed: metrics.audio.referenceCorrelation,
    timelineRange: millisecondsToFrameRange(0, groundTruth.audio.music.targetRangeMs.end),
    score: clamp(metrics.audio.referenceCorrelation),
    message: 'Rendered soundtrack must correlate with the final reference soundtrack.',
  });
  const observedCuts = (findPrimaryTrack(plan)?.clips ?? [])
    .slice(1)
    .map((clip) => clip?.timelineRange?.startFrame);
  const preservesCutSoundtrackAlignment =
    metrics.audio.referenceCorrelation >= groundTruth.audio.minimumReferenceCorrelation &&
    Number.isFinite(metrics.audio.referenceLagMs) &&
    Math.abs(metrics.audio.referenceLagMs) <= 50 &&
    sameArray(observedCuts, groundTruth.video.cutFrames);
  add({
    id: 'rhythm:cut-to-soundtrack-alignment',
    category: 'audio',
    pass: preservesCutSoundtrackAlignment,
    expected: {
      exactCutFrames: groundTruth.video.cutFrames,
      maximumReferenceAudioLagMs: 50,
      minimumReferenceCorrelation: groundTruth.audio.minimumReferenceCorrelation,
    },
    observed: {
      cutFrames: observedCuts,
      referenceAudioLagMs: metrics.audio.referenceLagMs,
      referenceCorrelation: metrics.audio.referenceCorrelation,
    },
    timelineRange: { startFrame: 0, endFrameExclusive: groundTruth.video.durationFrames },
    score: preservesCutSoundtrackAlignment ? metrics.audio.referenceCorrelation : 0,
    message:
      'Exact target cuts plus lag-bounded target soundtrack alignment preserve the target cut-to-beat relationship.',
  });
  add({
    id: 'render-audio:source-leakage',
    category: 'audio',
    pass:
      Number.isFinite(metrics.audio.sourceLeakageCorrelation) &&
      Math.abs(metrics.audio.sourceLeakageCorrelation) <=
        groundTruth.audio.maximumAbsoluteSourceLeakageCorrelation,
    expected: { maximumAbsolute: groundTruth.audio.maximumAbsoluteSourceLeakageCorrelation },
    observed: metrics.audio.sourceLeakageCorrelation,
    timelineRange: { startFrame: 0, endFrameExclusive: groundTruth.video.durationFrames },
    score: Number.isFinite(metrics.audio.sourceLeakageCorrelation)
      ? clamp(1 - Math.abs(metrics.audio.sourceLeakageCorrelation))
      : 0,
    message: 'Rendered output must not leak muted source-video audio.',
  });
}

function compareVideoClip(observed, expected, gates) {
  if (!isRecord(observed)) return [false];
  const checks = [
    observed.kind === expected.kind,
    sameRange(observed.timelineRange, expected.timelineRange, gates.cutFrameTolerance),
  ];
  if (expected.kind === 'black') return checks;
  checks.push(observed.assetId === expected.assetId);
  checks.push(observed.fit === expected.layout);
  if (expected.kind === 'freeze') {
    checks.push(
      within(observed.sourceFrame, expected.sourceFrame, gates.sourceInOutToleranceFrames),
    );
    return checks;
  }
  checks.push(
    sameRange(observed.sourceRange, expected.sourceRange, gates.sourceInOutToleranceFrames),
  );
  checks.push(within(observed.playbackRate, expected.playbackRate, 1e-6));
  return checks;
}

function normalizeRenderMetrics(input, frameRate, durationFrames) {
  const value = asRecord(input, 'render metrics');
  const rawWindows = Array.isArray(value.windows)
    ? value.windows
    : Array.isArray(value.perSegment)
      ? value.perSegment
      : [];
  const windows = rawWindows
    .map((window, index) => normalizeMetricWindow(window, frameRate, durationFrames, index))
    .filter(Boolean);
  const audio = isRecord(value.audio) ? value.audio : {};
  return {
    artifactId: nonEmptyString(value.artifactId, 'render:unknown'),
    global: isRecord(value.global)
      ? value.global
      : { ssim: value.ssim, psnrDb: value.psnrDb, vmaf: value.vmaf },
    windows,
    audio: {
      referenceCorrelation: finiteOr(audio.referenceCorrelation, Number.NaN),
      referenceLagMs: finiteOr(audio.reference?.lagMs, Number.NaN),
      sourceLeakageCorrelation: finiteOr(
        audio.sourceLeakageCorrelation ?? value.sourceLeakageCorrelation,
        Number.NaN,
      ),
    },
  };
}

function normalizeMetricWindow(input, frameRate, durationFrames, index) {
  if (!isRecord(input)) return null;
  let timelineRange = input.timelineRange;
  if (!isRecord(timelineRange) && Number.isFinite(input.startSeconds)) {
    const startFrame = Math.round(input.startSeconds * frameRate);
    timelineRange = {
      startFrame,
      endFrameExclusive: Math.round((input.startSeconds + input.durationSeconds) * frameRate),
    };
  }
  if (!validRange(timelineRange) || timelineRange.endFrameExclusive > durationFrames) return null;
  const score = finiteOr(input.score ?? input.ssim, Number.NaN);
  if (!Number.isFinite(score)) return null;
  return {
    id: nonEmptyString(input.id, `window-${index + 1}`),
    timelineRange: {
      startFrame: timelineRange.startFrame,
      endFrameExclusive: timelineRange.endFrameExclusive,
    },
    score: clamp(score),
    metric: nonEmptyString(input.metric, input.ssim != null ? 'ssim' : 'score'),
  };
}

function normalizeEvent(event) {
  return {
    id: safeId(event.id),
    category: event.category,
    pass: event.pass === true,
    score: clamp(event.score ?? (event.pass ? 1 : 0)),
    permanent: event.permanent === true,
    message: event.message,
    ...(validRange(event.timelineRange) ? { timelineRange: event.timelineRange } : {}),
    expected: jsonSafe(event.expected),
    observed: jsonSafe(event.observed),
  };
}

function eventFinding(event, artifactId) {
  return {
    id: `finding:${safeId(event.id)}`,
    severity: 'error',
    category: event.category,
    message: event.message,
    evidence: {
      artifactId,
      ...(event.timelineRange ? { timelineRange: event.timelineRange } : {}),
      expected: stringifyEvidence(event.expected),
      observed: stringifyEvidence(event.observed),
    },
  };
}

function criticScores(events) {
  const category = (name) =>
    average(events.filter((event) => event.category === name).map((event) => event.score));
  const mapping = category('mapping');
  const audio = category('audio');
  const framingEvents = events.filter(
    (event) =>
      event.category === 'framing' ||
      (event.category === 'mapping' && event.id.startsWith('video-clip:')),
  );
  const rhythmEvents = events.filter((event) =>
    [
      'audio-music-excerpt',
      'audio-silence-events',
      'audio-end-sting',
      'rhythm:cut-to-soundtrack-alignment',
    ].includes(event.id),
  );
  return {
    technical: category('technical'),
    mapping,
    rhythm: average(rhythmEvents.map((event) => event.score)),
    framing: average(framingEvents.map((event) => event.score)),
    text: category('text'),
    audio,
    grade: category('technical'),
    taste: null,
  };
}

function criticMetric(category) {
  return category === 'lineage' ? 'technical' : category;
}

function findPrimaryTrack(plan) {
  return allTracks(plan, 'video').find((track) => track.role === 'primary');
}

function allTracks(plan, kind) {
  return Array.isArray(plan.tracks) ? plan.tracks.filter((track) => track?.kind === kind) : [];
}

function summarizeVideoClip(clip) {
  if (!isRecord(clip)) return null;
  return {
    id: clip.id,
    kind: clip.kind,
    assetId: clip.assetId,
    timelineRange: clip.timelineRange,
    sourceRange: clip.sourceRange,
    sourceFrame: clip.sourceFrame,
    layout: clip.layout ?? clip.fit,
    playbackRate: clip.playbackRate,
  };
}

function millisecondsToFrameRange(startMs, endMs) {
  const frameRate = groundTruth.video.frameRate;
  const startFrame = Math.max(0, Math.floor((startMs / 1_000) * frameRate));
  const endFrameExclusive = Math.min(
    groundTruth.video.durationFrames,
    Math.ceil((endMs / 1_000) * frameRate),
  );
  return {
    startFrame,
    endFrameExclusive: Math.max(startFrame + 1, endFrameExclusive),
  };
}

function renderArtifactIdFor(plan, metrics) {
  if (isRecord(metrics) && typeof metrics.artifactId === 'string' && metrics.artifactId.trim()) {
    return metrics.artifactId.slice(0, 256);
  }
  return `plan:${safeId(plan.id ?? 'unknown')}`;
}

function stringifyEvidence(value) {
  const serialized = JSON.stringify(jsonSafe(value));
  return serialized.length <= 10_000 ? serialized : `${serialized.slice(0, 9_997)}...`;
}

function jsonSafe(value) {
  if (value === undefined || Number.isNaN(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim().normalize('NFC').toLocaleLowerCase('en-US') : '';
}

function sameRange(observed, expected, tolerance) {
  return (
    isRecord(observed) &&
    within(observed.startFrame, expected.startFrame, tolerance) &&
    within(observed.endFrameExclusive, expected.endFrameExclusive, tolerance)
  );
}

function contains(outer, inner) {
  return (
    validRange(outer) &&
    validRange(inner) &&
    outer.startFrame <= inner.startFrame &&
    outer.endFrameExclusive >= inner.endFrameExclusive
  );
}

function validRange(value) {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.startFrame) &&
    Number.isSafeInteger(value.endFrameExclusive) &&
    value.startFrame >= 0 &&
    value.endFrameExclusive > value.startFrame
  );
}

function within(value, expected, tolerance) {
  return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fractionPassing(checks) {
  return checks.length === 0 ? 1 : checks.filter(Boolean).length / checks.length;
}

function average(values) {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}

function safeId(value) {
  return (
    String(value)
      .replace(/[^a-zA-Z0-9._:-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 180) || 'event'
  );
}

function normalizeTimestamp(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('createdAt must be an ISO-compatible timestamp');
  return new Date(timestamp).toISOString();
}

function asRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
