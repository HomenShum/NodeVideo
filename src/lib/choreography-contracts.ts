import type { NormalizedBox } from './visual-grounding';

export const CHOREOGRAPHY_ANALYSIS_SCHEMA_VERSION = 'nodevideo.choreography-analysis.v1' as const;
export const SONG_CONDITIONED_PLAN_SCHEMA_VERSION = 'nodevideo.song-conditioned-plan.v1' as const;
export const CHOREOGRAPHY_FREEZE_SCHEMA_VERSION = 'nodevideo.choreography-freeze.v1' as const;

export interface FrameRange {
  startFrame: number;
  endFrameExclusive: number;
}

export interface MillisecondRange {
  startMs: number;
  endMs: number;
}

export interface BeatIndexRange {
  startIndex: number;
  endIndexExclusive: number;
}

export interface EvidenceScore {
  value: number;
  evidenceArtifactId: string;
}

export interface ChoreographyReference {
  assetId: string;
  sha256: string;
  mimeType: string;
  usage: 'analysis-only';
  sourceRange: FrameRange;
  frameRate: number;
  mirrorPolicy: 'as-recorded' | 'mirror' | 'auto';
  evidenceArtifactIds: string[];
}

export interface SongLicenseBoundary {
  status: 'owned' | 'licensed' | 'public-domain' | 'platform-handoff-only';
  proofRef: string;
}

export interface SongConditioningInput {
  assetId: string;
  sha256: string;
  mimeType: string;
  usage: 'render-source' | 'analysis-only';
  excerpt: MillisecondRange;
  license: SongLicenseBoundary;
  beatGrid: {
    bpm: number;
    beatsMs: number[];
    downbeatsMs: number[];
    evidenceArtifactId: string;
  };
}

export interface TimedTextInput {
  assetId: string;
  sha256: string;
  mimeType: 'application/json';
  usage: 'analysis-only';
  cueCount: number;
  license: SongLicenseBoundary;
}

export interface TakeAlignmentAnchor {
  referenceFrame: number;
  takeFrame: number;
  timelineMs: number;
  evidenceArtifactId: string;
}

export interface ChoreographyTake {
  id: string;
  assetId: string;
  sha256: string;
  mimeType: string;
  usage: 'render-source';
  sourceRange: FrameRange;
  frameRate: number;
  mirrorApplied: boolean;
  alignmentAnchors: TakeAlignmentAnchor[];
  evidenceArtifactIds: string[];
}

export interface ChoreographyPhrase {
  id: string;
  order: number;
  referenceRange: FrameRange;
  timelineRange: MillisecondRange;
  beatRange: BeatIndexRange;
  movementEvidenceArtifactIds: string[];
}

export interface TakeCandidateScores {
  timing: EvidenceScore;
  pose: EvidenceScore;
  motion: EvidenceScore;
  visibility: EvidenceScore;
  framing: EvidenceScore;
  technical: EvidenceScore;
}

export interface ChoreographyTakeCandidate {
  id: string;
  phraseId: string;
  takeId: string;
  sourceRange: FrameRange;
  timelineRange: MillisecondRange;
  scores: TakeCandidateScores;
  eligibility: 'eligible' | 'rejected';
  rejectionReasons: string[];
  evidenceArtifactIds: string[];
}

export interface CaptionLayout {
  id: string;
  phraseId?: string;
  timelineRange: MillisecondRange;
  text: string;
  lines: string[];
  box: NormalizedBox;
  templateId: string;
  bodyOverlapRatio: number;
  faceOverlapRatio: number;
  safeAreaEvidenceArtifactIds: string[];
  groundingResultId: string;
}

export interface ChoreographyAnalysisArtifact {
  schemaVersion: typeof CHOREOGRAPHY_ANALYSIS_SCHEMA_VERSION;
  id: string;
  runId: string;
  traceId: string;
  createdAt: string;
  reference: ChoreographyReference;
  song: SongConditioningInput;
  timedText: TimedTextInput;
  takes: ChoreographyTake[];
  phrases: ChoreographyPhrase[];
  candidates: ChoreographyTakeCandidate[];
  captionLayouts: CaptionLayout[];
  warnings: string[];
}

export interface PhraseSelection {
  phraseId: string;
  candidateId: string;
  cutBeatIndex: number;
  rationale: string;
  evidenceArtifactIds: string[];
}

export interface SongConditionedPlanArtifact {
  schemaVersion: typeof SONG_CONDITIONED_PLAN_SCHEMA_VERSION;
  id: string;
  analysisId: string;
  runId: string;
  traceId: string;
  createdAt: string;
  durationMs: number;
  selections: PhraseSelection[];
  captionLayouts: CaptionLayout[];
  editPlanArtifactId: string;
  editPlanSha256: string;
}

export interface ChoreographyFreezeArtifact {
  schemaVersion: typeof CHOREOGRAPHY_FREEZE_SCHEMA_VERSION;
  id: string;
  analysisId: string;
  planArtifactId: string;
  renderArtifactId: string;
  runId: string;
  traceId: string;
  frozenAt: string;
  digests: {
    input: string;
    analysis: string;
    plan: string;
    render: string;
    generationReadLog: string;
  };
  generationInputAssetIds: string[];
  evaluationOnlyAssetIds: string[];
  isolation: {
    generatorTargetAccess: 'denied';
    finalTargetMount: 'absent';
    evaluatorUnlock: 'after-freeze-verification';
  };
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_GENERATION_KEYS = new Set([
  'evaluationTarget',
  'evaluationTargetAssetId',
  'hiddenFinal',
  'hiddenFinalAssetId',
  'finalMp4',
  'groundTruth',
  'groundTruthAssetId',
]);

export function validateChoreographyAnalysis(
  value: unknown,
): asserts value is ChoreographyAnalysisArtifact {
  rejectForbiddenGenerationKeys(value, 'ChoreographyAnalysis');
  const analysis = asRecord(value, 'ChoreographyAnalysis');
  assertExactKeys(analysis, 'ChoreographyAnalysis', [
    'schemaVersion',
    'id',
    'runId',
    'traceId',
    'createdAt',
    'reference',
    'song',
    'timedText',
    'takes',
    'phrases',
    'candidates',
    'captionLayouts',
    'warnings',
  ]);
  assert(
    analysis.schemaVersion === CHOREOGRAPHY_ANALYSIS_SCHEMA_VERSION,
    'Unsupported ChoreographyAnalysis schema.',
  );
  assertId(analysis.id, 'ChoreographyAnalysis.id');
  assertId(analysis.runId, 'ChoreographyAnalysis.runId');
  assertId(analysis.traceId, 'ChoreographyAnalysis.traceId');
  assertIsoTimestamp(analysis.createdAt, 'ChoreographyAnalysis.createdAt');
  validateReference(analysis.reference, 'ChoreographyAnalysis.reference');
  validateSong(analysis.song, 'ChoreographyAnalysis.song');
  validateTimedText(analysis.timedText, 'ChoreographyAnalysis.timedText');
  const outputDuration = analysis.song.excerpt.endMs - analysis.song.excerpt.startMs;

  assert(
    Array.isArray(analysis.takes) && analysis.takes.length > 0,
    'At least one take is required.',
  );
  const takeIds = new Set<string>();
  const takeAssetIds = new Set<string>();
  const takeById = new Map<string, ChoreographyTake>();
  analysis.takes.forEach((item, index) => {
    const label = `ChoreographyAnalysis.takes[${index}]`;
    validateTake(item, label);
    assert(!takeIds.has(item.id), `${label}.id is duplicated.`);
    assert(!takeAssetIds.has(item.assetId), `${label}.assetId is duplicated.`);
    takeIds.add(item.id);
    takeAssetIds.add(item.assetId);
    takeById.set(item.id, item);
    for (const anchor of item.alignmentAnchors) {
      assert(
        anchor.referenceFrame >= analysis.reference.sourceRange.startFrame &&
          anchor.referenceFrame < analysis.reference.sourceRange.endFrameExclusive,
        `${label} alignment anchor exceeds the reference range.`,
      );
      assert(
        anchor.takeFrame >= item.sourceRange.startFrame &&
          anchor.takeFrame < item.sourceRange.endFrameExclusive,
        `${label} alignment anchor exceeds the take range.`,
      );
      assert(
        anchor.timelineMs <= outputDuration,
        `${label} alignment anchor exceeds the song excerpt.`,
      );
    }
  });
  assert(
    !takeAssetIds.has(analysis.reference.assetId) &&
      !takeAssetIds.has(analysis.song.assetId) &&
      analysis.reference.assetId !== analysis.song.assetId,
    'Reference, song, and take asset IDs must be distinct.',
  );

  assert(
    Array.isArray(analysis.phrases) && analysis.phrases.length > 0,
    'At least one choreography phrase is required.',
  );
  const phraseIds = new Set<string>();
  const phraseById = new Map<string, ChoreographyPhrase>();
  let previousTimelineEnd = 0;
  analysis.phrases.forEach((item, index) => {
    const label = `ChoreographyAnalysis.phrases[${index}]`;
    validatePhrase(item, label, analysis.song.beatGrid.beatsMs.length);
    assert(item.order === index, `${label}.order must match its zero-based position.`);
    assert(!phraseIds.has(item.id), `${label}.id is duplicated.`);
    assert(
      containsFrameRange(analysis.reference.sourceRange, item.referenceRange),
      `${label}.referenceRange exceeds the choreography reference.`,
    );
    assert(
      item.timelineRange.startMs === previousTimelineEnd,
      'Choreography phrase timeline ranges must be contiguous from zero.',
    );
    previousTimelineEnd = item.timelineRange.endMs;
    phraseIds.add(item.id);
    phraseById.set(item.id, item);
  });
  assert(
    previousTimelineEnd === outputDuration,
    'Choreography phrases must cover the selected song excerpt exactly.',
  );

  assert(Array.isArray(analysis.candidates), 'ChoreographyAnalysis.candidates must be an array.');
  const candidateIds = new Set<string>();
  const eligibleByPhrase = new Map<string, number>();
  analysis.candidates.forEach((item, index) => {
    const label = `ChoreographyAnalysis.candidates[${index}]`;
    validateCandidate(item, label);
    assert(!candidateIds.has(item.id), `${label}.id is duplicated.`);
    candidateIds.add(item.id);
    const phrase = phraseById.get(item.phraseId);
    assert(phrase, `${label}.phraseId does not exist.`);
    const take = takeById.get(item.takeId);
    assert(take, `${label}.takeId does not exist.`);
    assert(
      equalRange(item.timelineRange, phrase.timelineRange),
      `${label}.timelineRange must match its phrase.`,
    );
    assert(
      containsFrameRange(take.sourceRange, item.sourceRange),
      `${label}.sourceRange exceeds its take.`,
    );
    if (item.eligibility === 'eligible') {
      eligibleByPhrase.set(item.phraseId, (eligibleByPhrase.get(item.phraseId) ?? 0) + 1);
    }
  });
  for (const phraseId of phraseIds) {
    assert(
      (eligibleByPhrase.get(phraseId) ?? 0) > 0,
      `Phrase ${phraseId} has no eligible candidate.`,
    );
  }

  assert(Array.isArray(analysis.captionLayouts), 'captionLayouts must be an array.');
  const captionIds = new Set<string>();
  analysis.captionLayouts.forEach((item, index) => {
    const label = `ChoreographyAnalysis.captionLayouts[${index}]`;
    validateCaptionLayout(item, label);
    assert(!captionIds.has(item.id), `${label}.id is duplicated.`);
    captionIds.add(item.id);
    assert(item.timelineRange.endMs <= outputDuration, `${label} exceeds the output duration.`);
    if (item.phraseId !== undefined)
      assert(phraseIds.has(item.phraseId), `${label}.phraseId does not exist.`);
  });
  validateWarnings(analysis.warnings, 'ChoreographyAnalysis.warnings');
}

export function validateSongConditionedPlan(
  value: unknown,
  analysis?: ChoreographyAnalysisArtifact,
): asserts value is SongConditionedPlanArtifact {
  if (analysis) validateChoreographyAnalysis(analysis);
  rejectForbiddenGenerationKeys(value, 'SongConditionedPlan');
  const plan = asRecord(value, 'SongConditionedPlan');
  assertExactKeys(plan, 'SongConditionedPlan', [
    'schemaVersion',
    'id',
    'analysisId',
    'runId',
    'traceId',
    'createdAt',
    'durationMs',
    'selections',
    'captionLayouts',
    'editPlanArtifactId',
    'editPlanSha256',
  ]);
  assert(
    plan.schemaVersion === SONG_CONDITIONED_PLAN_SCHEMA_VERSION,
    'Unsupported song plan schema.',
  );
  assertId(plan.id, 'SongConditionedPlan.id');
  assertId(plan.analysisId, 'SongConditionedPlan.analysisId');
  assertId(plan.runId, 'SongConditionedPlan.runId');
  assertId(plan.traceId, 'SongConditionedPlan.traceId');
  assertIsoTimestamp(plan.createdAt, 'SongConditionedPlan.createdAt');
  assertPositiveNumber(plan.durationMs, 'SongConditionedPlan.durationMs');
  assertId(plan.editPlanArtifactId, 'SongConditionedPlan.editPlanArtifactId');
  assertSha256(plan.editPlanSha256, 'SongConditionedPlan.editPlanSha256');
  assert(
    Array.isArray(plan.selections) && plan.selections.length > 0,
    'Plan selections are required.',
  );
  const selectedPhrases = new Set<string>();
  plan.selections.forEach((item, index) => {
    const label = `SongConditionedPlan.selections[${index}]`;
    validateSelection(item, label);
    assert(!selectedPhrases.has(item.phraseId), `${label}.phraseId is duplicated.`);
    selectedPhrases.add(item.phraseId);
  });
  assert(
    Array.isArray(plan.captionLayouts),
    'SongConditionedPlan.captionLayouts must be an array.',
  );
  plan.captionLayouts.forEach((item, index) =>
    validateCaptionLayout(item, `SongConditionedPlan.captionLayouts[${index}]`),
  );

  if (analysis) {
    assert(plan.analysisId === analysis.id, 'Plan analysis ID does not match.');
    assert(plan.runId === analysis.runId, 'Plan run ID does not match.');
    assert(plan.traceId === analysis.traceId, 'Plan trace ID does not match.');
    const duration = analysis.song.excerpt.endMs - analysis.song.excerpt.startMs;
    assert(plan.durationMs === duration, 'Plan duration does not match the song excerpt.');
    const phrases = new Map(analysis.phrases.map((item) => [item.id, item]));
    const candidates = new Map(analysis.candidates.map((item) => [item.id, item]));
    assert(
      plan.selections.length === phrases.size,
      'Plan must select exactly one candidate per phrase.',
    );
    for (const selection of plan.selections) {
      const phrase = phrases.get(selection.phraseId);
      const candidate = candidates.get(selection.candidateId);
      assert(phrase, `Selection phrase ${selection.phraseId} does not exist.`);
      assert(candidate, `Selection candidate ${selection.candidateId} does not exist.`);
      assert(candidate.phraseId === phrase.id, 'Selected candidate belongs to another phrase.');
      assert(candidate.eligibility === 'eligible', 'Rejected candidates cannot be selected.');
      assert(
        selection.cutBeatIndex >= phrase.beatRange.startIndex &&
          selection.cutBeatIndex < phrase.beatRange.endIndexExclusive,
        'Selection cut beat lies outside its phrase.',
      );
    }
    for (const phraseId of phrases.keys())
      assert(selectedPhrases.has(phraseId), `Phrase ${phraseId} is unselected.`);
    for (const caption of plan.captionLayouts) {
      if (caption.phraseId !== undefined) {
        assert(phrases.has(caption.phraseId), `Caption phrase ${caption.phraseId} does not exist.`);
      }
      assert(caption.timelineRange.endMs <= duration, 'Plan caption exceeds the output duration.');
    }
  }
}

export function validateChoreographyFreeze(
  value: unknown,
  analysis?: ChoreographyAnalysisArtifact,
): asserts value is ChoreographyFreezeArtifact {
  if (analysis) validateChoreographyAnalysis(analysis);
  const freeze = asRecord(value, 'ChoreographyFreeze');
  assertExactKeys(freeze, 'ChoreographyFreeze', [
    'schemaVersion',
    'id',
    'analysisId',
    'planArtifactId',
    'renderArtifactId',
    'runId',
    'traceId',
    'frozenAt',
    'digests',
    'generationInputAssetIds',
    'evaluationOnlyAssetIds',
    'isolation',
  ]);
  assert(freeze.schemaVersion === CHOREOGRAPHY_FREEZE_SCHEMA_VERSION, 'Unsupported freeze schema.');
  for (const key of [
    'id',
    'analysisId',
    'planArtifactId',
    'renderArtifactId',
    'runId',
    'traceId',
  ] as const) {
    assertId(freeze[key], `ChoreographyFreeze.${key}`);
  }
  assertIsoTimestamp(freeze.frozenAt, 'ChoreographyFreeze.frozenAt');
  const digests = asRecord(freeze.digests, 'ChoreographyFreeze.digests');
  assertExactKeys(digests, 'ChoreographyFreeze.digests', [
    'input',
    'analysis',
    'plan',
    'render',
    'generationReadLog',
  ]);
  for (const key of ['input', 'analysis', 'plan', 'render', 'generationReadLog']) {
    assertSha256(digests[key], `ChoreographyFreeze.digests.${key}`);
  }
  const generationIds = validateUniqueIds(
    freeze.generationInputAssetIds,
    'ChoreographyFreeze.generationInputAssetIds',
    1,
  );
  const evaluationIds = validateUniqueIds(
    freeze.evaluationOnlyAssetIds,
    'ChoreographyFreeze.evaluationOnlyAssetIds',
    1,
  );
  for (const id of evaluationIds) {
    assert(!generationIds.has(id), 'Evaluation-only assets cannot appear in generation inputs.');
  }
  const isolation = asRecord(freeze.isolation, 'ChoreographyFreeze.isolation');
  assertExactKeys(isolation, 'ChoreographyFreeze.isolation', [
    'generatorTargetAccess',
    'finalTargetMount',
    'evaluatorUnlock',
  ]);
  assert(isolation.generatorTargetAccess === 'denied', 'Generator target access must be denied.');
  assert(isolation.finalTargetMount === 'absent', 'Final target must be absent at freeze time.');
  assert(
    isolation.evaluatorUnlock === 'after-freeze-verification',
    'Evaluator unlock must follow freeze verification.',
  );
  if (analysis) {
    assert(freeze.analysisId === analysis.id, 'Freeze analysis ID does not match.');
    assert(freeze.runId === analysis.runId, 'Freeze run ID does not match.');
    assert(freeze.traceId === analysis.traceId, 'Freeze trace ID does not match.');
    const expected = new Set([
      analysis.reference.assetId,
      analysis.song.assetId,
      analysis.timedText.assetId,
      ...analysis.takes.map((item) => item.assetId),
    ]);
    assert(
      setEquals(generationIds, expected),
      'Freeze generation inputs do not match analysis inputs.',
    );
  }
}

function validateReference(value: unknown, label: string): asserts value is ChoreographyReference {
  const reference = asRecord(value, label);
  assertExactKeys(reference, label, [
    'assetId',
    'sha256',
    'mimeType',
    'usage',
    'sourceRange',
    'frameRate',
    'mirrorPolicy',
    'evidenceArtifactIds',
  ]);
  assertId(reference.assetId, `${label}.assetId`);
  assertSha256(reference.sha256, `${label}.sha256`);
  assertMime(reference.mimeType, 'video/', `${label}.mimeType`);
  assert(reference.usage === 'analysis-only', `${label}.usage must be analysis-only.`);
  validateFrameRange(reference.sourceRange, `${label}.sourceRange`);
  assertPositiveNumber(reference.frameRate, `${label}.frameRate`);
  assertOneOf(reference.mirrorPolicy, ['as-recorded', 'mirror', 'auto'], `${label}.mirrorPolicy`);
  validateUniqueIds(reference.evidenceArtifactIds, `${label}.evidenceArtifactIds`, 1);
}

function validateSong(value: unknown, label: string): asserts value is SongConditioningInput {
  const song = asRecord(value, label);
  assertExactKeys(song, label, [
    'assetId',
    'sha256',
    'mimeType',
    'usage',
    'excerpt',
    'license',
    'beatGrid',
  ]);
  assertId(song.assetId, `${label}.assetId`);
  assertSha256(song.sha256, `${label}.sha256`);
  assertMime(song.mimeType, 'audio/', `${label}.mimeType`);
  assertOneOf(song.usage, ['render-source', 'analysis-only'], `${label}.usage`);
  validateMillisecondRange(song.excerpt, `${label}.excerpt`);
  const license = asRecord(song.license, `${label}.license`);
  assertExactKeys(license, `${label}.license`, ['status', 'proofRef']);
  assertOneOf(
    license.status,
    ['owned', 'licensed', 'public-domain', 'platform-handoff-only'],
    `${label}.license.status`,
  );
  assertBoundedString(license.proofRef, `${label}.license.proofRef`, 2_048);
  if (license.status === 'platform-handoff-only') {
    assert(
      song.usage === 'analysis-only',
      'Platform-handoff-only music cannot be a render source.',
    );
  }
  const grid = asRecord(song.beatGrid, `${label}.beatGrid`);
  assertExactKeys(grid, `${label}.beatGrid`, [
    'bpm',
    'beatsMs',
    'downbeatsMs',
    'evidenceArtifactId',
  ]);
  assertPositiveNumber(grid.bpm, `${label}.beatGrid.bpm`);
  validateStrictlyIncreasingNumbers(grid.beatsMs, `${label}.beatGrid.beatsMs`, 1);
  validateStrictlyIncreasingNumbers(grid.downbeatsMs, `${label}.beatGrid.downbeatsMs`, 0);
  const beatSet = new Set(grid.beatsMs);
  for (const downbeat of grid.downbeatsMs)
    assert(beatSet.has(downbeat), 'Every downbeat must be a beat.');
  const outputDuration = song.excerpt.endMs - song.excerpt.startMs;
  assert(
    grid.beatsMs.every((beat) => beat <= outputDuration),
    `${label}.beatGrid exceeds the selected excerpt.`,
  );
  assertId(grid.evidenceArtifactId, `${label}.beatGrid.evidenceArtifactId`);
}

function validateTimedText(value: unknown, label: string): asserts value is TimedTextInput {
  const timedText = asRecord(value, label);
  assertExactKeys(timedText, label, [
    'assetId',
    'sha256',
    'mimeType',
    'usage',
    'cueCount',
    'license',
  ]);
  assertId(timedText.assetId, `${label}.assetId`);
  assertSha256(timedText.sha256, `${label}.sha256`);
  assert(timedText.mimeType === 'application/json', `${label}.mimeType must be application/json.`);
  assert(timedText.usage === 'analysis-only', `${label}.usage must be analysis-only.`);
  assertNonNegativeInteger(timedText.cueCount, `${label}.cueCount`);
  assert(timedText.cueCount > 0, `${label}.cueCount must be positive.`);
  const license = asRecord(timedText.license, `${label}.license`);
  assertExactKeys(license, `${label}.license`, ['status', 'proofRef']);
  assertOneOf(
    license.status,
    ['owned', 'licensed', 'public-domain', 'platform-handoff-only'],
    `${label}.license.status`,
  );
  assertBoundedString(license.proofRef, `${label}.license.proofRef`, 2_048);
}

function validateTake(value: unknown, label: string): asserts value is ChoreographyTake {
  const take = asRecord(value, label);
  assertExactKeys(take, label, [
    'id',
    'assetId',
    'sha256',
    'mimeType',
    'usage',
    'sourceRange',
    'frameRate',
    'mirrorApplied',
    'alignmentAnchors',
    'evidenceArtifactIds',
  ]);
  assertId(take.id, `${label}.id`);
  assertId(take.assetId, `${label}.assetId`);
  assertSha256(take.sha256, `${label}.sha256`);
  assertMime(take.mimeType, 'video/', `${label}.mimeType`);
  assert(take.usage === 'render-source', `${label}.usage must be render-source.`);
  validateFrameRange(take.sourceRange, `${label}.sourceRange`);
  assertPositiveNumber(take.frameRate, `${label}.frameRate`);
  assert(typeof take.mirrorApplied === 'boolean', `${label}.mirrorApplied must be boolean.`);
  assert(
    Array.isArray(take.alignmentAnchors) && take.alignmentAnchors.length >= 2,
    `${label} needs two anchors.`,
  );
  let previous = { referenceFrame: -1, takeFrame: -1, timelineMs: -1 };
  take.alignmentAnchors.forEach((item, index) => {
    const anchorLabel = `${label}.alignmentAnchors[${index}]`;
    const anchor = asRecord(item, anchorLabel);
    assertExactKeys(anchor, anchorLabel, [
      'referenceFrame',
      'takeFrame',
      'timelineMs',
      'evidenceArtifactId',
    ]);
    for (const key of ['referenceFrame', 'takeFrame', 'timelineMs'] as const) {
      assertNonNegativeInteger(anchor[key], `${anchorLabel}.${key}`);
      assert(anchor[key] > previous[key], `${anchorLabel}.${key} must be strictly increasing.`);
    }
    assertId(anchor.evidenceArtifactId, `${anchorLabel}.evidenceArtifactId`);
    previous = anchor as TakeAlignmentAnchor;
  });
  validateUniqueIds(take.evidenceArtifactIds, `${label}.evidenceArtifactIds`, 1);
}

function validatePhrase(
  value: unknown,
  label: string,
  beatCount: number,
): asserts value is ChoreographyPhrase {
  const phrase = asRecord(value, label);
  assertExactKeys(phrase, label, [
    'id',
    'order',
    'referenceRange',
    'timelineRange',
    'beatRange',
    'movementEvidenceArtifactIds',
  ]);
  assertId(phrase.id, `${label}.id`);
  assertNonNegativeInteger(phrase.order, `${label}.order`);
  validateFrameRange(phrase.referenceRange, `${label}.referenceRange`);
  validateMillisecondRange(phrase.timelineRange, `${label}.timelineRange`);
  const beats = asRecord(phrase.beatRange, `${label}.beatRange`);
  assertExactKeys(beats, `${label}.beatRange`, ['startIndex', 'endIndexExclusive']);
  assertNonNegativeInteger(beats.startIndex, `${label}.beatRange.startIndex`);
  assertNonNegativeInteger(beats.endIndexExclusive, `${label}.beatRange.endIndexExclusive`);
  assert(beats.endIndexExclusive > beats.startIndex, `${label}.beatRange is empty.`);
  assert(beats.endIndexExclusive <= beatCount, `${label}.beatRange exceeds the beat grid.`);
  validateUniqueIds(phrase.movementEvidenceArtifactIds, `${label}.movementEvidenceArtifactIds`, 1);
}

function validateCandidate(
  value: unknown,
  label: string,
): asserts value is ChoreographyTakeCandidate {
  const candidate = asRecord(value, label);
  assertExactKeys(candidate, label, [
    'id',
    'phraseId',
    'takeId',
    'sourceRange',
    'timelineRange',
    'scores',
    'eligibility',
    'rejectionReasons',
    'evidenceArtifactIds',
  ]);
  assertId(candidate.id, `${label}.id`);
  assertId(candidate.phraseId, `${label}.phraseId`);
  assertId(candidate.takeId, `${label}.takeId`);
  validateFrameRange(candidate.sourceRange, `${label}.sourceRange`);
  validateMillisecondRange(candidate.timelineRange, `${label}.timelineRange`);
  const scores = asRecord(candidate.scores, `${label}.scores`);
  assertExactKeys(scores, `${label}.scores`, [
    'timing',
    'pose',
    'motion',
    'visibility',
    'framing',
    'technical',
  ]);
  for (const key of ['timing', 'pose', 'motion', 'visibility', 'framing', 'technical']) {
    validateEvidenceScore(scores[key], `${label}.scores.${key}`);
  }
  assertOneOf(candidate.eligibility, ['eligible', 'rejected'], `${label}.eligibility`);
  validateBoundedStrings(candidate.rejectionReasons, `${label}.rejectionReasons`, 1_000);
  assert(
    candidate.eligibility === 'rejected'
      ? candidate.rejectionReasons.length > 0
      : candidate.rejectionReasons.length === 0,
    `${label}.rejectionReasons do not match eligibility.`,
  );
  validateUniqueIds(candidate.evidenceArtifactIds, `${label}.evidenceArtifactIds`, 1);
}

function validateCaptionLayout(value: unknown, label: string): asserts value is CaptionLayout {
  const caption = asRecord(value, label);
  assertExactKeys(
    caption,
    label,
    [
      'id',
      'timelineRange',
      'text',
      'lines',
      'box',
      'templateId',
      'bodyOverlapRatio',
      'faceOverlapRatio',
      'safeAreaEvidenceArtifactIds',
      'groundingResultId',
    ],
    ['phraseId'],
  );
  assertId(caption.id, `${label}.id`);
  if (caption.phraseId !== undefined) assertId(caption.phraseId, `${label}.phraseId`);
  validateMillisecondRange(caption.timelineRange, `${label}.timelineRange`);
  assertBoundedString(caption.text, `${label}.text`, 500);
  validateBoundedStrings(caption.lines, `${label}.lines`, 250, 1, 2);
  assert(caption.text === caption.lines.join('\n'), `${label}.text must equal its joined lines.`);
  assert(isNormalizedBox(caption.box), `${label}.box must use normalized 0..1 coordinates.`);
  assertId(caption.templateId, `${label}.templateId`);
  assertUnitInterval(caption.bodyOverlapRatio, `${label}.bodyOverlapRatio`);
  assertUnitInterval(caption.faceOverlapRatio, `${label}.faceOverlapRatio`);
  assert(caption.bodyOverlapRatio <= 0.05, `${label} overlaps the body by more than 5%.`);
  assert(caption.faceOverlapRatio === 0, `${label} must not overlap a face.`);
  validateUniqueIds(caption.safeAreaEvidenceArtifactIds, `${label}.safeAreaEvidenceArtifactIds`, 1);
  assertId(caption.groundingResultId, `${label}.groundingResultId`);
}

function validateSelection(value: unknown, label: string): asserts value is PhraseSelection {
  const selection = asRecord(value, label);
  assertExactKeys(selection, label, [
    'phraseId',
    'candidateId',
    'cutBeatIndex',
    'rationale',
    'evidenceArtifactIds',
  ]);
  assertId(selection.phraseId, `${label}.phraseId`);
  assertId(selection.candidateId, `${label}.candidateId`);
  assertNonNegativeInteger(selection.cutBeatIndex, `${label}.cutBeatIndex`);
  assertBoundedString(selection.rationale, `${label}.rationale`, 2_000);
  validateUniqueIds(selection.evidenceArtifactIds, `${label}.evidenceArtifactIds`, 1);
}

function validateEvidenceScore(value: unknown, label: string): asserts value is EvidenceScore {
  const score = asRecord(value, label);
  assertExactKeys(score, label, ['value', 'evidenceArtifactId']);
  assertUnitInterval(score.value, `${label}.value`);
  assertId(score.evidenceArtifactId, `${label}.evidenceArtifactId`);
}

function validateFrameRange(value: unknown, label: string): asserts value is FrameRange {
  const range = asRecord(value, label);
  assertExactKeys(range, label, ['startFrame', 'endFrameExclusive']);
  assertNonNegativeInteger(range.startFrame, `${label}.startFrame`);
  assertNonNegativeInteger(range.endFrameExclusive, `${label}.endFrameExclusive`);
  assert(range.endFrameExclusive > range.startFrame, `${label} is empty.`);
}

function validateMillisecondRange(
  value: unknown,
  label: string,
): asserts value is MillisecondRange {
  const range = asRecord(value, label);
  assertExactKeys(range, label, ['startMs', 'endMs']);
  assertFiniteNumber(range.startMs, `${label}.startMs`);
  assertFiniteNumber(range.endMs, `${label}.endMs`);
  assert(range.startMs >= 0 && range.endMs > range.startMs, `${label} is invalid.`);
}

function validateStrictlyIncreasingNumbers(
  value: unknown,
  label: string,
  minimumLength: number,
): asserts value is number[] {
  assert(Array.isArray(value) && value.length >= minimumLength, `${label} is invalid.`);
  let previous = -1;
  value.forEach((item, index) => {
    assertFiniteNumber(item, `${label}[${index}]`);
    assert(item >= 0 && item > previous, `${label} must be strictly increasing.`);
    previous = item;
  });
}

function validateUniqueIds(value: unknown, label: string, minimumLength = 0): Set<string> {
  assert(Array.isArray(value) && value.length >= minimumLength, `${label} is invalid.`);
  const ids = new Set<string>();
  value.forEach((item, index) => {
    assertId(item, `${label}[${index}]`);
    assert(!ids.has(item), `${label} contains a duplicate ID.`);
    ids.add(item);
  });
  return ids;
}

function validateWarnings(value: unknown, label: string): asserts value is string[] {
  validateBoundedStrings(value, label, 2_000);
}

function validateBoundedStrings(
  value: unknown,
  label: string,
  maximum: number,
  minimumLength = 0,
  maximumLength = 1_000,
): asserts value is string[] {
  assert(
    Array.isArray(value) && value.length >= minimumLength && value.length <= maximumLength,
    `${label} is invalid.`,
  );
  value.forEach((item, index) => assertBoundedString(item, `${label}[${index}]`, maximum));
}

function isNormalizedBox(value: unknown): value is NormalizedBox {
  if (!isRecord(value)) return false;
  if (!['x', 'y', 'width', 'height'].every((key) => Object.hasOwn(value, key))) return false;
  if (Object.keys(value).some((key) => !['x', 'y', 'width', 'height'].includes(key))) return false;
  const { x, y, width, height } = value;
  return (
    [x, y, width, height].every((item) => typeof item === 'number' && Number.isFinite(item)) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 + 1e-9 &&
    y + height <= 1 + 1e-9
  );
}

function rejectForbiddenGenerationKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenGenerationKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    assert(!FORBIDDEN_GENERATION_KEYS.has(key), `${path}.${key} is forbidden before freeze.`);
    rejectForbiddenGenerationKeys(item, `${path}.${key}`);
  }
}

function containsFrameRange(container: FrameRange, child: FrameRange): boolean {
  return (
    child.startFrame >= container.startFrame &&
    child.endFrameExclusive <= container.endFrameExclusive
  );
}

function equalRange(left: MillisecondRange, right: MillisecondRange): boolean {
  return left.startMs === right.startMs && left.endMs === right.endMs;
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function asRecord(value: unknown, label: string): Record<string, any> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, any>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label}.${key} is not allowed.`);
}

function assertId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && ID_PATTERN.test(value), `${label} is invalid.`);
}

function assertSha256(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && SHA256_PATTERN.test(value),
    `${label} must be a sha256 digest.`,
  );
}

function assertMime(value: unknown, prefix: string, label: string): asserts value is string {
  assert(
    typeof value === 'string' && value.startsWith(prefix) && value.length <= 120,
    `${label} is invalid.`,
  );
}

function assertBoundedString(value: unknown, label: string, max: number): asserts value is string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label} is invalid.`,
  );
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  assert(typeof value === 'string' && allowed.includes(value as T), `${label} is invalid.`);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be finite.`);
}

function assertPositiveNumber(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  assert(value > 0, `${label} must be positive.`);
}

function assertUnitInterval(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  assert(value >= 0 && value <= 1, `${label} must be between 0 and 1.`);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  assert(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    `${label} is invalid.`,
  );
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    `${label} must be an ISO timestamp.`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
