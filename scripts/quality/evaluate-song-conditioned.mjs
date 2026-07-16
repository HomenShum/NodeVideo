import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256File, writeJson } from '../media/media-proof-lib.mjs';

export const SONG_CONDITIONED_EVALUATOR_VERSION =
  'nodevideo.song-conditioned-postfreeze-evaluator@1.0.0';
export const CUT_TOLERANCE_SECONDS = 0.75;

const TARGETISH_KEY =
  /^(?:groundTruth|heldOut|target(?:Asset|Audio|Edit|File|Hash|Id|Media|Path|Picture|Plan|Video)|evaluationOnly)/iu;
const TARGETISH_FILE =
  /(?:^|[._ -])(?:authorized[._ -]?real|evaluation[._ -]?only|final[._ -]?(?:edit|mp4)|ground[._ -]?truth|held[._ -]?out|reference[._ -]?target|target(?:[._ -]?(?:derived|edit|hash|path|picture|plan|video))?)(?:$|[._ -])/iu;
const TARGETISH_IDENTIFIER =
  /(?:^|[._/\\ -])(?:authorized[._ -]?real|evaluation[._ -]?only|ground[._ -]?truth|held[._ -]?out|reference[._ -]?target|target(?:[._ -]?(?:derived|picture|plan|video))?|final[._ -]?(?:edit|mp4))(?:$|[._/\\ -])/iu;
const IDENTIFIER_KEY = /(?:asset|file|id|path|ref|source|uri)$/iu;
const ORACLE_MODE = 'target-picture-isolated-target-audio-oracle';
const ORACLE_ASSET_ID = 'asset.music';
const ORACLE_PROOF_REF = 'authorization.owner-provided-target-audio-oracle';
const ORACLE_FALSE_KEYS = new Set([
  'targetPictureMountedDuringGeneration',
  'targetPictureReadDuringGeneration',
  'targetPlanReadDuringGeneration',
  'targetPictureRead',
  'targetPlanRead',
]);

/**
 * Verify a generation freeze and compare its generated EditPlan with an evaluator-only
 * EditPlan. The evaluator-only file is not opened until every generation artifact has
 * passed its receipt hash and isolation checks.
 */
export async function evaluateSongConditioned({
  freezePath,
  generatedPlanPath,
  targetPlanPath,
  outputPath,
  allowTargetAudioOracle = false,
}) {
  if (typeof allowTargetAudioOracle !== 'boolean') {
    throw new Error('allowTargetAudioOracle must be boolean.');
  }
  const paths = normalizeInputPaths({
    freezePath,
    generatedPlanPath,
    targetPlanPath,
    outputPath,
  });

  // Phase 1: generation-side verification. Do not move target-plan I/O above this line.
  const freezeBytes = await readFile(paths.freezePath);
  const freeze = parseJson(freezeBytes, 'generation freeze');
  validateFreezeEnvelope(freeze, allowTargetAudioOracle);
  const verified = await verifyFrozenFiles(paths.freezePath, freeze.files);
  const generated = await loadFrozenGeneratedPlan(paths.generatedPlanPath, verified);
  const generatedPlan = parseAndValidatePlan(generated.bytes, 'generated EditPlan');
  assertGenerationPlanIsolation(generatedPlan, allowTargetAudioOracle);
  assertNoTargetLeakageInFrozenJson(verified, allowTargetAudioOracle);
  if (allowTargetAudioOracle) assertTargetAudioOracleDisclosure(verified);

  // Phase 2: evaluator-only target unseal. All generation files are verified above.
  const targetRealPath = await realpath(paths.targetPlanPath);
  if (verified.some((entry) => entry.realPath === targetRealPath)) {
    throw new Error('The evaluator-only target was present in the generation freeze.');
  }
  const targetBytes = await readFile(targetRealPath);
  const targetPlanHash = digest(targetBytes);
  if (verified.some((entry) => entry.sha256 === targetPlanHash)) {
    throw new Error('Target-derived content was present in the generation freeze.');
  }
  if (verified.some((entry) => entry.jsonText?.toLowerCase().includes(targetPlanHash))) {
    throw new Error('The evaluator-only target hash leaked into a frozen generation artifact.');
  }
  const targetPlan = parseAndValidatePlan(targetBytes, 'evaluator-only EditPlan');

  const report = buildReport({
    freeze,
    freezeHash: digest(freezeBytes),
    generatedPlan,
    generatedPlanHash: generated.sha256,
    targetPlan,
    targetPlanHash,
    verifiedFileCount: verified.length,
    targetAudioOracleUsed: allowTargetAudioOracle,
  });
  assertReportContainsNoPaths(report);
  await writeJson(paths.outputPath, report);
  return report;
}

export function comparePlans(generatedPlan, targetPlan, toleranceSeconds = CUT_TOLERANCE_SECONDS) {
  const generatedPrimary = primaryVideoTrack(generatedPlan, 'generated EditPlan');
  const targetPrimary = primaryVideoTrack(targetPlan, 'evaluator-only EditPlan');
  const generatedCuts = cutBoundariesSeconds(generatedPrimary, generatedPlan.frameRate);
  const targetCuts = cutBoundariesSeconds(targetPrimary, targetPlan.frameRate);
  const cuts = matchBoundaries(generatedCuts, targetCuts, toleranceSeconds);
  const generatedDurationSeconds = generatedPlan.durationFrames / generatedPlan.frameRate;
  const targetDurationSeconds = targetPlan.durationFrames / targetPlan.frameRate;

  return {
    duration: {
      generatedSeconds: round(generatedDurationSeconds),
      targetSeconds: round(targetDurationSeconds),
      differenceSeconds: round(generatedDurationSeconds - targetDurationSeconds),
      absoluteDifferenceSeconds: round(Math.abs(generatedDurationSeconds - targetDurationSeconds)),
    },
    cutBoundaries: cuts,
    phraseSourceAgreement: comparePhraseSources(
      generatedPrimary,
      generatedPlan.frameRate,
      targetPrimary,
      targetPlan.frameRate,
    ),
  };
}

export function neutralSourceLabel(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  const prefixed = normalized.match(/(?:^|[._-])(?:source|take)[._-]?([ab])(?:[._-]|$)/u);
  if (prefixed) return prefixed[1].toUpperCase();
  const suffix = normalized.match(/(?:^|[._-])([ab])$/u);
  return suffix ? suffix[1].toUpperCase() : null;
}

function buildReport({
  freeze,
  freezeHash,
  generatedPlan,
  generatedPlanHash,
  targetPlan,
  targetPlanHash,
  verifiedFileCount,
  targetAudioOracleUsed,
}) {
  return {
    schemaVersion: 'nodevideo.song-conditioned-postfreeze-evaluation.v1',
    evaluatorVersion: SONG_CONDITIONED_EVALUATOR_VERSION,
    createdAt: freeze.createdAt,
    artifactBindings: {
      freezeReceiptSha256: freezeHash,
      generatedPlanSha256: generatedPlanHash,
      evaluatorOnlyPlanSha256: targetPlanHash,
    },
    isolation: {
      passed: true,
      verifiedGenerationFileCount: verifiedFileCount,
      targetMountedDuringGeneration: false,
      targetReadDuringGeneration: false,
      targetOpenedOnlyAfterFreezeVerification: true,
      targetAudioOracleUsed,
      ...(targetAudioOracleUsed
        ? {
            targetPictureMountedDuringGeneration: false,
            targetPictureReadDuringGeneration: false,
            targetPlanReadDuringGeneration: false,
          }
        : {}),
    },
    technicalComparison: comparePlans(generatedPlan, targetPlan),
    tasteStatus: 'not-evaluated',
    claim: targetAudioOracleUsed
      ? 'This calibration measures target-picture-isolated timing and neutral A/B source decisions; song or excerpt selection and creative taste are not proven because target-derived authorized audio was supplied as an oracle.'
      : 'This report measures timing and neutral A/B source-decision similarity only; it does not establish creative taste.',
  };
}

function validateFreezeEnvelope(value, allowTargetAudioOracle) {
  if (!isRecord(value)) throw new Error('Generation freeze must be a JSON object.');
  if (value.targetMountedDuringGeneration !== false) {
    throw new Error('Freeze must attest targetMountedDuringGeneration=false.');
  }
  if (value.targetReadDuringGeneration !== false) {
    throw new Error('Freeze must attest targetReadDuringGeneration=false.');
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('Freeze must hash at least one generation file.');
  }
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Freeze createdAt must be an ISO timestamp.');
  }
  if (allowTargetAudioOracle && value.targetPlanReadDuringGeneration !== false) {
    throw new Error('Oracle freeze must attest targetPlanReadDuringGeneration=false.');
  }
  const allowedKeys = new Set(['targetMountedDuringGeneration', 'targetReadDuringGeneration']);
  if (allowTargetAudioOracle) allowedKeys.add('targetPlanReadDuringGeneration');
  assertNoTargetFields(value, 'freeze', allowedKeys, allowTargetAudioOracle);
}

async function verifyFrozenFiles(freezePath, records) {
  const freezeRoot = dirname(resolve(freezePath));
  const freezeRootRealPath = await realpath(freezeRoot);
  const seen = new Set();
  const verified = [];

  for (const [index, record] of records.entries()) {
    if (!isRecord(record)) throw new Error(`Frozen file record ${index} must be an object.`);
    const name = record.file ?? record.path;
    if (typeof name !== 'string' || name.trim() === '' || isAbsolute(name)) {
      throw new Error(`Frozen file record ${index} must use a relative file name.`);
    }
    if (TARGETISH_FILE.test(name)) {
      throw new Error('The generation freeze names evaluator-only target material.');
    }
    if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(record.sha256)) {
      throw new Error(`Frozen file record ${index} has an invalid SHA-256 digest.`);
    }

    const lexicalPath = resolve(freezeRoot, name);
    if (!isInside(freezeRoot, lexicalPath)) {
      throw new Error(`Frozen file record ${index} escapes the freeze directory.`);
    }
    const fileStats = await lstat(lexicalPath);
    if (fileStats.isSymbolicLink()) {
      throw new Error(`Frozen file record ${index} must not be a symbolic link.`);
    }
    const fileRealPath = await realpath(lexicalPath);
    if (!isInside(freezeRootRealPath, fileRealPath)) {
      throw new Error(`Frozen file record ${index} resolves outside the freeze directory.`);
    }
    if (seen.has(fileRealPath)) throw new Error('Freeze contains a duplicate file record.');
    seen.add(fileRealPath);

    const actualHash = await sha256File(fileRealPath);
    if (actualHash !== record.sha256) {
      throw new Error(`Frozen generation file ${index} no longer matches its receipt.`);
    }
    const bytes = await readFile(fileRealPath);
    if (record.bytes != null && record.bytes !== bytes.byteLength) {
      throw new Error(`Frozen generation file ${index} no longer matches its byte count.`);
    }
    const jsonText = extname(name).toLowerCase() === '.json' ? bytes.toString('utf8') : null;
    verified.push({ bytes, jsonText, realPath: fileRealPath, sha256: actualHash });
  }
  return verified;
}

async function loadFrozenGeneratedPlan(generatedPlanPath, verified) {
  const generatedRealPath = await realpath(generatedPlanPath);
  const record = verified.find((entry) => entry.realPath === generatedRealPath);
  if (!record) throw new Error('The generated EditPlan is not bound by the supplied freeze.');
  return record;
}

function assertNoTargetLeakageInFrozenJson(verified, allowTargetAudioOracle) {
  const allowedTargetKeys = allowTargetAudioOracle
    ? new Set([...ORACLE_FALSE_KEYS, 'targetAudioOracle'])
    : new Set();
  for (const [index, entry] of verified.entries()) {
    if (entry.jsonText == null) continue;
    const parsed = parseJson(entry.bytes, `frozen JSON artifact ${index}`);
    assertNoTargetFields(
      parsed,
      `frozen JSON artifact ${index}`,
      allowedTargetKeys,
      allowTargetAudioOracle,
    );
  }
}

function assertNoTargetFields(value, label, allowedTargetKeys, allowTargetAudioOracle) {
  visit(value, label, (entry, key, path) => {
    const lineageKey = key === 'evaluationOnlyAssetIds' || key === 'targetDerivedRenderAssetIds';
    if (allowedTargetKeys.has(key)) {
      if (ORACLE_FALSE_KEYS.has(key) && entry !== false) {
        throw new Error(`${path} must be false in target-audio-oracle mode.`);
      }
      if (key === 'targetAudioOracle' && !isRecord(entry)) {
        throw new Error(`${path} must be an oracle disclosure object.`);
      }
    }
    if (key != null && TARGETISH_KEY.test(key) && !allowedTargetKeys.has(key) && !lineageKey) {
      throw new Error(`${path} is forbidden in a pre-evaluation freeze.`);
    }
    if (key === 'evaluationOnlyAssetIds') {
      if (
        !Array.isArray(entry) ||
        entry.some(
          (assetId) =>
            typeof assetId !== 'string' ||
            TARGETISH_IDENTIFIER.test(assetId) ||
            assetId === ORACLE_ASSET_ID,
        )
      ) {
        throw new Error(`${path} contains target-derived or render-lineage material.`);
      }
    }
    if (key === 'targetDerivedRenderAssetIds') {
      const expected = allowTargetAudioOracle ? [ORACLE_ASSET_ID] : [];
      if (!sameStringArray(entry, expected)) {
        throw new Error(
          `${path} must ${allowTargetAudioOracle ? 'contain only the authorized music oracle' : 'be empty'} before evaluator unlock.`,
        );
      }
    }
    if (
      typeof entry === 'string' &&
      TARGETISH_IDENTIFIER.test(entry) &&
      isIdentifierContext(key, entry) &&
      !(allowTargetAudioOracle && entry === ORACLE_PROOF_REF)
    ) {
      throw new Error(`${path} identifies evaluator-only or target-derived material.`);
    }
  });
}

function assertGenerationPlanIsolation(plan, allowTargetAudioOracle) {
  const lineage = plan.lineage;
  if (!isRecord(lineage)) throw new Error('Generated EditPlan must include lineage.');
  if (
    !Array.isArray(lineage.evaluationOnlyAssetIds) ||
    lineage.evaluationOnlyAssetIds.length !== 0
  ) {
    throw new Error('Generated EditPlan lineage.evaluationOnlyAssetIds must be empty.');
  }
  const expectedTargetDerived = allowTargetAudioOracle ? [ORACLE_ASSET_ID] : [];
  if (!sameStringArray(lineage.targetDerivedRenderAssetIds, expectedTargetDerived)) {
    throw new Error(
      `Generated EditPlan lineage.targetDerivedRenderAssetIds must ${allowTargetAudioOracle ? 'contain only asset.music' : 'be empty'}.`,
    );
  }
  if (!Array.isArray(lineage.renderAssetIds)) {
    throw new Error('Generated EditPlan lineage.renderAssetIds must be an array.');
  }
  for (const assetId of lineage.renderAssetIds) {
    if (typeof assetId !== 'string' || TARGETISH_IDENTIFIER.test(assetId)) {
      throw new Error('Generated EditPlan render lineage contains target-derived material.');
    }
  }
}

function assertTargetAudioOracleDisclosure(verified) {
  const jsonArtifacts = verified
    .filter((entry) => entry.jsonText != null)
    .map((entry, index) => parseJson(entry.bytes, `oracle JSON artifact ${index}`));
  const manifests = jsonArtifacts.filter((value) => value?.mode === ORACLE_MODE);
  if (manifests.length !== 1) {
    throw new Error('Target-audio-oracle mode requires exactly one frozen generation manifest.');
  }
  const manifest = manifests[0];
  if (manifest.schemaVersion !== 'nodevideo.song-conditioned-generation-manifest.v1') {
    throw new Error('Target-audio-oracle manifest has an unsupported schema.');
  }
  const isolation = manifest.isolation;
  if (!isRecord(isolation))
    throw new Error('Target-audio-oracle manifest must disclose isolation.');
  for (const key of [
    'targetPictureMountedDuringGeneration',
    'targetPictureReadDuringGeneration',
    'targetPlanReadDuringGeneration',
  ]) {
    if (isolation[key] !== false)
      throw new Error(`Oracle manifest isolation.${key} must be false.`);
  }
  const oracle = isolation.targetAudioOracle;
  if (
    !isRecord(oracle) ||
    oracle.used !== true ||
    oracle.proofRef !== ORACLE_PROOF_REF ||
    typeof oracle.limitation !== 'string' ||
    !/does not prove song or excerpt selection/iu.test(oracle.limitation)
  ) {
    throw new Error('Target-audio-oracle manifest disclosure is incomplete.');
  }

  for (const artifact of jsonArtifacts) {
    visit(artifact, 'oracle artifact', (entry, key, path) => {
      if (key !== 'targetIsolation') return;
      if (!isRecord(entry) || entry.targetPictureRead !== false || entry.targetPlanRead !== false) {
        throw new Error(`${path} must attest target picture and plan were not read.`);
      }
    });
  }
}

function parseAndValidatePlan(bytes, label) {
  const plan = parseJson(bytes, label);
  if (!isRecord(plan) || plan.schemaVersion !== 'nodevideo.edit-plan.v1') {
    throw new Error(`${label} must use nodevideo.edit-plan.v1.`);
  }
  if (!Number.isFinite(plan.frameRate) || plan.frameRate <= 0) {
    throw new Error(`${label} frameRate must be positive.`);
  }
  if (!Number.isInteger(plan.durationFrames) || plan.durationFrames <= 0) {
    throw new Error(`${label} durationFrames must be a positive integer.`);
  }
  const primary = primaryVideoTrack(plan, label);
  for (const [index, clip] of primary.clips.entries()) {
    const range = clip?.timelineRange;
    if (
      !Number.isInteger(range?.startFrame) ||
      !Number.isInteger(range?.endFrameExclusive) ||
      range.startFrame < 0 ||
      range.endFrameExclusive <= range.startFrame ||
      range.endFrameExclusive > plan.durationFrames
    ) {
      throw new Error(`${label} primary clip ${index} has an invalid timeline range.`);
    }
  }
  return plan;
}

function primaryVideoTrack(plan, label) {
  const tracks = Array.isArray(plan?.tracks) ? plan.tracks : [];
  const matches = tracks.filter((track) => track?.kind === 'video' && track?.role === 'primary');
  if (matches.length !== 1 || !Array.isArray(matches[0].clips) || matches[0].clips.length === 0) {
    throw new Error(`${label} must have exactly one non-empty primary video track.`);
  }
  return matches[0];
}

function cutBoundariesSeconds(track, frameRate) {
  return track.clips
    .slice(1)
    .map((clip) => clip.timelineRange.startFrame / frameRate)
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0)
    .sort((left, right) => left - right);
}

function matchBoundaries(generated, target, toleranceSeconds) {
  const candidates = [];
  for (const [generatedIndex, generatedSeconds] of generated.entries()) {
    for (const [targetIndex, targetSeconds] of target.entries()) {
      candidates.push({
        generatedIndex,
        targetIndex,
        errorSeconds: Math.abs(generatedSeconds - targetSeconds),
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.errorSeconds - right.errorSeconds ||
      left.generatedIndex - right.generatedIndex ||
      left.targetIndex - right.targetIndex,
  );
  const usedGenerated = new Set();
  const usedTarget = new Set();
  let matchedCount = 0;
  for (const candidate of candidates) {
    if (candidate.errorSeconds > toleranceSeconds) break;
    if (usedGenerated.has(candidate.generatedIndex) || usedTarget.has(candidate.targetIndex))
      continue;
    usedGenerated.add(candidate.generatedIndex);
    usedTarget.add(candidate.targetIndex);
    matchedCount += 1;
  }

  const precision = ratio(matchedCount, generated.length, target.length === 0);
  const recall = ratio(matchedCount, target.length, generated.length === 0);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const nearestErrors =
    generated.length && target.length
      ? generated.map((value) =>
          Math.min(...target.map((candidate) => Math.abs(value - candidate))),
        )
      : [];

  return {
    method: 'one-to-one-nearest-neighbor',
    toleranceSeconds,
    generatedCount: generated.length,
    targetCount: target.length,
    matchedCount,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    meanNearestNeighborErrorSeconds: nearestErrors.length === 0 ? null : round(mean(nearestErrors)),
    maxNearestNeighborErrorSeconds:
      nearestErrors.length === 0 ? null : round(Math.max(...nearestErrors)),
  };
}

function comparePhraseSources(generatedTrack, generatedRate, targetTrack, targetRate) {
  const phrases = generatedTrack.clips
    .filter((clip) => clip?.kind === 'source')
    .map((clip, index) => {
      const midpointSeconds =
        (clip.timelineRange.startFrame + clip.timelineRange.endFrameExclusive) / 2 / generatedRate;
      const targetClip = targetTrack.clips.find(
        (candidate) =>
          midpointSeconds >= candidate.timelineRange.startFrame / targetRate &&
          midpointSeconds < candidate.timelineRange.endFrameExclusive / targetRate,
      );
      const generatedSource = neutralSourceLabel(clip.assetId);
      const targetSource = neutralSourceLabel(targetClip?.assetId);
      return {
        phrase: index + 1,
        generatedSource,
        targetSource,
        comparable: generatedSource != null && targetSource != null,
        agrees: generatedSource != null && targetSource != null && generatedSource === targetSource,
      };
    });
  const comparable = phrases.filter((phrase) => phrase.comparable);
  const agreementCount = comparable.filter((phrase) => phrase.agrees).length;
  return {
    method: 'generated-phrase-midpoint-with-neutral-A/B-suffix-mapping',
    generatedPhraseCount: phrases.length,
    comparablePhraseCount: comparable.length,
    agreementCount,
    agreementRatio: comparable.length === 0 ? null : round(agreementCount / comparable.length),
    phrases,
  };
}

function assertReportContainsNoPaths(report) {
  visit(report, 'report', (value, key) => {
    if (key != null && /(?:file|filename|path)$/iu.test(key)) {
      throw new Error('Evaluation report must not preserve file names or paths.');
    }
    if (
      typeof value === 'string' &&
      (/[a-z]:[\\/]/iu.test(value) || value.includes('\\') || value.includes('/.qa/'))
    ) {
      throw new Error('Evaluation report must not preserve private filesystem paths.');
    }
  });
}

function visit(value, path, visitor, key = null) {
  visitor(value, key, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, visitor, null));
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    visit(childValue, `${path}.${childKey}`, visitor, childKey);
  }
}

function normalizeInputPaths(values) {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${key} is required.`);
    }
  }
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, resolve(value)]),
  );
  if (normalized.generatedPlanPath === normalized.targetPlanPath) {
    throw new Error('Generated and evaluator-only plans must be different files.');
  }
  if (
    normalized.outputPath === normalized.freezePath ||
    normalized.outputPath === normalized.generatedPlanPath ||
    normalized.outputPath === normalized.targetPlanPath
  ) {
    throw new Error('Evaluation output must not overwrite an input artifact.');
  }
  return normalized;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function isInside(root, candidate) {
  const inside = relative(root, candidate);
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sameStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function isIdentifierContext(key, value) {
  return (
    (key != null && IDENTIFIER_KEY.test(key)) ||
    /^(?:asset|file|media|plan|video)[._-]/iu.test(value) ||
    /^[a-z]:[\\/]/iu.test(value) ||
    value.startsWith('/')
  );
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ratio(numerator, denominator, otherIsEmpty) {
  if (denominator > 0) return numerator / denominator;
  return otherIsEmpty ? 1 : 0;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Number(value.toFixed(6));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--') || key === '--help') continue;
    if (key === '--allow-target-audio-oracle') {
      parsed['allow-target-audio-oracle'] = true;
      continue;
    }
    const value = args[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Usage: node scripts/quality/evaluate-song-conditioned.mjs --freeze <receipt.json> --generated-plan <plan.json> --target-plan <held-out-plan.json> --output <report.json> [--allow-target-audio-oracle]',
    );
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  await evaluateSongConditioned({
    freezePath: options.freeze,
    generatedPlanPath: options['generated-plan'],
    targetPlanPath: options['target-plan'],
    outputPath: options.output,
    allowTargetAudioOracle: options['allow-target-audio-oracle'] === true,
  });
  console.log('Post-freeze evaluation completed.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
