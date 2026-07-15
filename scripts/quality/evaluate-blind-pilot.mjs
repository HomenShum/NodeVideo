import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const options = parseArgs(process.argv.slice(2));
const pilotRoot = resolve(options.pilot ?? '.qa/evidence/private/blind-source-only-pilot-01');
const groundTruthPath = resolve(
  options.groundTruth ?? 'packs/reference-reconstruct/evals/authorized-real-v2-ground-truth.json',
);
const outputPath = resolve(options.output ?? `${pilotRoot}/post-freeze/held-out-evaluation.json`);

const freezeBytes = await readFile(resolveInside(pilotRoot, 'freeze.json'));
const freeze = JSON.parse(freezeBytes);
for (const file of freeze.files) {
  const bytes = await readFile(resolveInside(pilotRoot, file.path));
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`Frozen file ${file.path} no longer matches its receipt.`);
  }
}
const freezeVerifiedAt = new Date().toISOString();
const editPlan = JSON.parse(await readFile(resolveInside(pilotRoot, 'edit-plan.json'), 'utf8'));
const musicHandoff = JSON.parse(
  await readFile(resolveInside(pilotRoot, 'music-handoff.json'), 'utf8'),
);
const readLog = JSON.parse(await readFile(resolveInside(pilotRoot, 'read-log.json'), 'utf8'));
const selectedMusic = musicHandoff.selected_candidates[0];

// The evaluator-only target is intentionally opened only after every generation hash passes.
const groundTruthBytes = await readFile(groundTruthPath);
const targetUnsealedAt = new Date().toISOString();
const groundTruth = JSON.parse(groundTruthBytes);

const frameRate = groundTruth.video.frameRate;
const horizonSeconds = editPlan.output.duration_seconds;
const agentCutSeconds = editPlan.timeline
  .slice(0, -1)
  .map((clip) => clip.output.end_frame_exclusive / editPlan.output.frame_rate_fps);
const targetCutSeconds = groundTruth.video.cutFrames
  .map((frame) => frame / frameRate)
  .filter((seconds) => seconds > 0 && seconds < horizonSeconds);
const cutScore = matchCuts(agentCutSeconds, targetCutSeconds, 0.5);
const sourceIdentityCoverage = scoreSourceCoverage(editPlan.timeline, groundTruth, horizonSeconds);
const targetTextCuesInHorizon = groundTruth.textCues.filter(
  (cue) => cue.startFrame / frameRate < horizonSeconds,
).length;
const isolationPassed =
  readLog.isolation_attestation?.forbidden_material_accessed === false &&
  readLog.isolation_attestation?.parent_directories_listed_or_searched === false &&
  readLog.isolation_attestation?.target_or_reference_material_accessed === false;

const evaluation = {
  schemaVersion: 'nodevideo.held-out-evaluation.v1',
  caseId: 'blind-source-only-pilot-01',
  runOrder: {
    generationFreezeSha256: sha256(freezeBytes),
    freezeVerifiedAt,
    targetGroundTruthSha256: sha256(groundTruthBytes),
    targetUnsealedAt,
    targetWasReadAfterFreezeVerification: targetUnsealedAt >= freezeVerifiedAt,
  },
  isolationAudit: {
    passed: isolationPassed,
    filesystemBoundary: 'audited fresh-context isolation; not an OS-enforced sandbox',
    generationInputRoles: ['sanitized-source-video', 'public-music-catalog'],
    privateReadLogSha256: sha256(await readFile(resolveInside(pilotRoot, 'read-log.json'))),
  },
  technicalComparison: {
    agentDurationSeconds: horizonSeconds,
    targetDurationSeconds: groundTruth.video.durationFrames / frameRate,
    durationRatio: round(horizonSeconds / (groundTruth.video.durationFrames / frameRate)),
    cutBoundaries: {
      agentSeconds: agentCutSeconds.map(round),
      heldOutTargetSecondsWithinAgentHorizon: targetCutSeconds.map(round),
      toleranceSeconds: cutScore.toleranceSeconds,
      matches: cutScore.matches,
      precision: cutScore.precision,
      recall: cutScore.recall,
      f1: cutScore.f1,
    },
    sourceIdentityCoverageWithinAgentHorizon: sourceIdentityCoverage,
    text: {
      agentCueCount: editPlan.text_cues.length,
      heldOutTargetCueCountTotal: groundTruth.textCues.length,
      heldOutTargetCueCountWithinAgentHorizon: targetTextCuesInHorizon,
      scoredAsTaste: false,
    },
    summary: `The blind edit independently found ${cutScore.matches.length} of ${targetCutSeconds.length} held-out picture changes inside its shorter ${round(horizonSeconds)}-second horizon within ${cutScore.toleranceSeconds} seconds, while choosing its own pacing, source moments, text, and duration.`,
  },
  musicComparison: {
    agentRecommendation: `${selectedMusic.track} — ${selectedMusic.artist}; catalog-preview-relative cue at approximately ${round(selectedMusic.analysis_estimated_bpm)} BPM`,
    heldOutTarget: `${groundTruth.audio.music.title} — ${groundTruth.audio.music.artist}`,
    exactTrackMatched: false,
    interpretation:
      'A different concrete track can still be a valid creative recommendation. No taste score is inferred from title identity, catalog preview analysis, or target soundtrack similarity.',
  },
  taste: {
    status: 'awaiting-blinded-human-evaluation',
    score: null,
    requiredEvidence:
      'Randomized A/B preference against a preregistered baseline across at least 20 held-out cases.',
  },
};

if (!isolationPassed) throw new Error('The generation read log failed the isolation audit.');
await writeFile(outputPath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
console.log(`Wrote held-out evaluation: ${outputPath}`);

function scoreSourceCoverage(agentClips, target, horizonSeconds) {
  const targetClips = target.video.clips.filter((clip) => clip.kind === 'source');
  const boundaries = new Set([0, horizonSeconds]);
  for (const clip of agentClips) {
    boundaries.add(Math.min(horizonSeconds, clip.output.start_seconds));
    boundaries.add(Math.min(horizonSeconds, clip.output.end_seconds));
  }
  for (const clip of targetClips) {
    boundaries.add(
      Math.min(horizonSeconds, clip.timelineRange.startFrame / target.video.frameRate),
    );
    boundaries.add(
      Math.min(horizonSeconds, clip.timelineRange.endFrameExclusive / target.video.frameRate),
    );
  }
  const ordered = [...boundaries].filter((value) => value >= 0).sort((a, b) => a - b);
  let matchedSeconds = 0;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end <= start) continue;
    const midpoint = (start + end) / 2;
    const agent = agentClips.find(
      (clip) => midpoint >= clip.output.start_seconds && midpoint < clip.output.end_seconds,
    );
    const reference = targetClips.find(
      (clip) =>
        midpoint >= clip.timelineRange.startFrame / target.video.frameRate &&
        midpoint < clip.timelineRange.endFrameExclusive / target.video.frameRate,
    );
    if (sourceLabel(agent?.source.file) === sourceLabel(reference?.assetId)) {
      matchedSeconds += end - start;
    }
  }
  return {
    matchedSeconds: round(matchedSeconds),
    totalSeconds: horizonSeconds,
    ratio: round(matchedSeconds / horizonSeconds),
  };
}

function matchCuts(agentCuts, targetCuts, toleranceSeconds) {
  const available = new Set(agentCuts.map((_, index) => index));
  const matches = [];
  for (const targetSeconds of targetCuts) {
    const candidates = [...available]
      .map((index) => ({ delta: Math.abs(agentCuts[index] - targetSeconds), index }))
      .filter(({ delta }) => delta <= toleranceSeconds)
      .sort((a, b) => a.delta - b.delta);
    if (!candidates.length) continue;
    const best = candidates[0];
    available.delete(best.index);
    matches.push({
      agentSeconds: round(agentCuts[best.index]),
      deltaSeconds: round(best.delta),
      targetSeconds: round(targetSeconds),
    });
  }
  const precision = matches.length / Math.max(agentCuts.length, 1);
  const recall = matches.length / Math.max(targetCuts.length, 1);
  return {
    f1: round(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
    matches,
    precision: round(precision),
    recall: round(recall),
    toleranceSeconds,
  };
}

function sourceLabel(value = '') {
  if (/source-a|source-a-original/i.test(value)) return 'source-a';
  if (/source-b|source-b-original/i.test(value)) return 'source-b';
  return 'none';
}

function resolveInside(root, relativePath) {
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error('Pilot path escaped its root.');
  return path;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function round(value) {
  return Number(value.toFixed(6));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    parsed[args[index].replace(/^--/, '')] = args[index + 1];
  }
  return parsed;
}
