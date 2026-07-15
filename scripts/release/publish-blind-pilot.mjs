import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const CASE_ID = 'blind-source-only-pilot-01';
const OUTPUT_NAMES = [
  'edit-plan.json',
  'freeze.json',
  'held-out-comparison.mp4',
  'held-out-evaluation.json',
  'manifest.json',
  'music-handoff.json',
  'rationale.md',
  'read-log.json',
  'redaction-receipt.json',
  'source-only-preview.mp4',
];

const options = parseArgs(process.argv.slice(2));
const inputRoot = resolve(options.input ?? '.qa/evidence/private/blind-source-only-pilot-01');
const outputRoot = resolve(options.output ?? 'fixtures/media/blind-source-only-pilot-01');
const fixturesRoot = resolve('fixtures');
if (!outputRoot.startsWith(`${fixturesRoot}${sep}`)) {
  throw new Error('Blind-pilot release output must stay under fixtures.');
}
await mkdir(outputRoot, { recursive: true });
await assertNoUnknownOutputs(outputRoot);

const freezeBytes = await readFile(resolveInside(inputRoot, 'freeze.json'));
const freeze = parseJson(freezeBytes, 'freeze.json');
for (const file of freeze.files) {
  const bytes = await readFile(resolveInside(inputRoot, file.path));
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`Frozen file ${file.path} failed release verification.`);
  }
}

const editPlanBytes = await readFile(resolveInside(inputRoot, 'edit-plan.json'));
const musicBytes = await readFile(resolveInside(inputRoot, 'music-handoff.json'));
const rationaleBytes = await readFile(resolveInside(inputRoot, 'rationale.md'));
const readLogBytes = await readFile(resolveInside(inputRoot, 'read-log.json'));
const evaluationBytes = await readFile(
  resolveInside(inputRoot, 'post-freeze/held-out-evaluation.json'),
);
const comparisonPath = resolveInside(inputRoot, 'post-freeze/held-out-comparison.mp4');
const previewPath = resolveInside(inputRoot, 'source-only-preview.mp4');
const comparisonBytes = await readFile(comparisonPath);
const previewBytes = await readFile(previewPath);
const editPlan = parseJson(editPlanBytes, 'edit-plan.json');
const music = parseJson(musicBytes, 'music-handoff.json');
const privateReadLog = parseJson(readLogBytes, 'read-log.json');
const evaluation = parseJson(evaluationBytes, 'held-out-evaluation.json');
const selected = music.selected_candidates[0];

assertEvidenceChain({
  editPlan,
  evaluation,
  freeze,
  freezeBytes,
  readLog: privateReadLog,
  readLogBytes,
});
const previewProbe = probeMedia(previewPath, 'source-only preview');
const comparisonProbe = probeMedia(comparisonPath, 'held-out comparison');
assertMediaContract({ comparisonProbe, editPlan, evaluation, previewProbe });

const publicReadLog = structuredClone(privateReadLog);
publicReadLog.pilot_directory = '<isolated-pilot>';
publicReadLog.isolation_attestation.network_exception =
  'Public Apple/iTunes catalog metadata and public catalog preview URLs were used after explicit authorization. No product repository, target, reference, prior plan, or target-derived URL was accessed.';
for (const invocation of publicReadLog.tool_invocations) {
  if (typeof invocation.result_summary === 'string') {
    invocation.result_summary = invocation.result_summary.replace(
      'Woman remained the better target fit.',
      'Woman remained the better candidate fit.',
    );
  }
}
const publicReadLogBytes = jsonBytes(publicReadLog);

const redactionReceipt = {
  schemaVersion: 'nodevideo.public-redaction-receipt.v1',
  sourcePrivateReadLogSha256: sha256(readLogBytes),
  publicReadLogSha256: sha256(publicReadLogBytes),
  redactions: [
    'Replaced the local pilot directory with <isolated-pilot>.',
    'Replaced the product repository name with a generic label.',
    'Described catalog preview URLs neutrally without making a legal characterization.',
    'Clarified one catalog-ranking sentence from target fit to candidate fit.',
  ],
  contentRemoved: ['local filesystem path'],
  generationDecisionsChanged: false,
};
const redactionReceiptBytes = jsonBytes(redactionReceipt);

const baseUrl = '/media/blind-source-only-pilot-01';
const publicFiles = new Map([
  ['edit-plan.json', editPlanBytes],
  ['freeze.json', freezeBytes],
  ['held-out-comparison.mp4', comparisonBytes],
  ['held-out-evaluation.json', evaluationBytes],
  ['music-handoff.json', musicBytes],
  ['rationale.md', rationaleBytes],
  ['read-log.json', publicReadLogBytes],
  ['redaction-receipt.json', redactionReceiptBytes],
  ['source-only-preview.mp4', previewBytes],
]);
const artifactSpecs = [
  ['edit-plan', 'Frozen edit plan', 'edit-plan.json', 'application/json'],
  ['music-handoff', 'Music handoff', 'music-handoff.json', 'application/json'],
  ['rationale', 'Creative rationale', 'rationale.md', 'text/markdown; charset=utf-8'],
  ['read-log', 'Sanitized read log', 'read-log.json', 'application/json'],
  ['freeze', 'Generation freeze', 'freeze.json', 'application/json'],
  ['held-out-evaluation', 'Held-out evaluation', 'held-out-evaluation.json', 'application/json'],
  [
    'held-out-comparison',
    'Held-out target | blind (silent)',
    'held-out-comparison.mp4',
    'video/mp4',
  ],
  ['redaction-receipt', 'Redaction receipt', 'redaction-receipt.json', 'application/json'],
];
const artifacts = [];
for (const [id, label, name, mimeType] of artifactSpecs) {
  const bytes = publicFiles.get(name);
  if (!bytes) throw new Error(`Missing allowlisted release bytes for ${name}.`);
  artifacts.push({
    id,
    label,
    mimeType,
    sha256: sha256(bytes),
    url: `${baseUrl}/${name}`,
  });
}
const criticalAnchors = music.output_time_anchors.filter(({ priority }) => priority === 'critical');
const referenceStartSeconds = selected.candidate_segment.preview_start_seconds;
const referenceEndSeconds = selected.candidate_segment.preview_end_seconds;
const referenceDurationSeconds = deriveCatalogPreviewReferenceDuration(privateReadLog);
if (
  !Number.isFinite(referenceStartSeconds) ||
  !Number.isFinite(referenceEndSeconds) ||
  referenceStartSeconds < 0 ||
  referenceEndSeconds <= referenceStartSeconds ||
  referenceDurationSeconds < referenceEndSeconds
) {
  throw new Error('The catalog-preview reference timing is invalid or exceeds its evidence.');
}
const manifest = {
  schemaVersion: 'nodevideo.blind-source-only-pilot.v1',
  id: 'blind-source-only-pilot-01',
  title: 'Blind source-only edit and Instagram music handoff',
  protocol: {
    freshPlannerContext: true,
    frozenAt: evaluation.runOrder.freezeVerifiedAt,
    publicCatalogAllowed: true,
    sourceInputSha256: freeze.files
      .filter(({ role }) => role === 'input')
      .map(({ sha256: hash }) => hash),
    targetAccessDuringGeneration: false,
    targetMountedDuringGeneration: false,
  },
  verdict: {
    limitations: [
      'This is one audited fresh-context pilot, not an OS-enforced sandbox.',
      'One case cannot prove generalized creative taste; blinded human preference is still pending.',
      'The candidate segment is catalog-preview-relative and must be located by ear in Instagram.',
    ],
    protocolStatus: evaluation.isolationAudit.passed ? 'passed' : 'blocked',
    summary:
      'The edit and music choice were frozen before target unseal. Post-freeze evaluation found both held-out picture changes inside the shorter edit within 0.5 seconds, while also showing a different duration, source-moment selection, text strategy, and track.',
    tasteStatus: 'awaiting-blinded-human-evaluation',
    tasteEvidenceRef: null,
  },
  claimBoundary: {
    proven: [
      'For this pilot, a fresh planner produced the edit, sparse text, crop strategy, music archetype, and concrete track candidate from two sanitized source videos plus public catalog context before target unseal.',
      'The public preview, plan, music handoff, read log, freeze, silent held-out comparison, and evaluation are hash-bound.',
    ],
    notClaimed: [
      'General creative superiority, target equivalence, or a blinded taste score.',
      'Cryptographic or OS-level filesystem isolation for the planner.',
      'A verified full-track or Instagram waveform offset for the candidate.',
      'Instagram availability, music ownership, redistribution rights, or automated licensing.',
    ],
  },
  preview: {
    audioPolicy: 'commercial-music-absent',
    durationSeconds: previewProbe.durationSeconds,
    height: previewProbe.video.height,
    mimeType: 'video/mp4',
    ratio: round(previewProbe.video.width / previewProbe.video.height),
    sha256: sha256(previewBytes),
    url: `${baseUrl}/source-only-preview.mp4`,
    width: previewProbe.video.width,
  },
  musicHandoff: {
    anchors: criticalAnchors.map((anchor, index) => ({
      id: `critical-${index + 1}`,
      label: `${anchor.picture}; ${anchor.land_on}`,
      referenceSeconds: round(referenceStartSeconds + anchor.seconds),
      videoSeconds: anchor.seconds,
    })),
    artist: selected.artist,
    availabilityStatus: 'confirm-in-instagram',
    commercialAudioPublished: false,
    rationale: selected.why_it_fits,
    referenceBasis: 'catalog-preview-relative',
    referenceCue: 'steady 108 BPM groove phrase; locate the same phrase by ear',
    referenceDurationSeconds,
    referenceEndSeconds,
    referenceStartSeconds,
    searchQuery: `${selected.track} ${selected.artist}`,
    title: selected.track,
  },
  instagramHandoff: {
    steps: [
      'Download the clean edit.',
      `Search for ${selected.track} by ${selected.artist} and confirm the exact recording.`,
      'Locate the steady groove phrase by ear; the displayed timestamps are catalog-preview-relative, not a verified Instagram offset.',
      'Align the first strong downbeat to video 0:00.060 and verify every critical anchor.',
      'Mute the synthetic guide metronome before publishing.',
    ],
    userAddsAudioInInstagram: true,
  },
  artifacts,
};
const manifestBytes = jsonBytes(manifest);
publicFiles.set('manifest.json', manifestBytes);
assertExactOutputSet(publicFiles);
scanPublicOutputs(
  publicFiles,
  new Map([
    ['held-out-comparison.mp4', comparisonProbe.privacyText],
    ['source-only-preview.mp4', previewProbe.privacyText],
  ]),
);
await Promise.all(
  [...publicFiles].map(([name, bytes]) => writeFile(resolve(outputRoot, name), bytes)),
);
await assertExactOutputDirectory(outputRoot, publicFiles);
console.log(`VITE_NODEVIDEO_BLIND_MANIFEST_SHA256=${sha256(manifestBytes)}`);

function assertEvidenceChain({ editPlan, evaluation, freeze, freezeBytes, readLog, readLogBytes }) {
  if (
    freeze.submission !== CASE_ID ||
    editPlan.project !== CASE_ID ||
    evaluation.caseId !== CASE_ID
  ) {
    throw new Error('The freeze, plan, and held-out evaluation must use the blind pilot case ID.');
  }
  if (evaluation.runOrder?.generationFreezeSha256 !== sha256(freezeBytes)) {
    throw new Error('The held-out evaluation is not bound to this generation freeze.');
  }
  if (evaluation.isolationAudit?.privateReadLogSha256 !== sha256(readLogBytes)) {
    throw new Error('The held-out evaluation is not bound to this private read log.');
  }
  const attestation = readLog.isolation_attestation;
  if (
    evaluation.isolationAudit?.passed !== true ||
    freeze.isolation_attested !== true ||
    attestation?.forbidden_material_accessed !== false ||
    attestation?.parent_directories_listed_or_searched !== false ||
    attestation?.target_or_reference_material_accessed !== false
  ) {
    throw new Error('The blind-generation isolation evidence did not pass.');
  }

  const freezeVerifiedAt = Date.parse(evaluation.runOrder?.freezeVerifiedAt);
  const targetUnsealedAt = Date.parse(evaluation.runOrder?.targetUnsealedAt);
  if (
    evaluation.runOrder?.targetWasReadAfterFreezeVerification !== true ||
    !Number.isFinite(freezeVerifiedAt) ||
    !Number.isFinite(targetUnsealedAt) ||
    targetUnsealedAt < freezeVerifiedAt
  ) {
    throw new Error('The target-unseal ordering is missing or invalid.');
  }

  const planDuration = editPlan.output?.duration_seconds;
  const evaluatedDuration = evaluation.technicalComparison?.agentDurationSeconds;
  if (
    !Number.isFinite(planDuration) ||
    !Number.isFinite(evaluatedDuration) ||
    Math.abs(planDuration - evaluatedDuration) > 0.000001
  ) {
    throw new Error('The held-out evaluation duration does not match the frozen edit plan.');
  }
}

function probeMedia(path, label) {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:format_tags:stream=index,codec_type,width,height,duration:stream_tags',
      '-of',
      'json',
      path,
    ],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Could not probe the ${label}: ${result.error?.message ?? result.stderr}`);
  }
  const probe = parseJson(Buffer.from(result.stdout, 'utf8'), `${label} ffprobe output`);
  const videos = probe.streams?.filter(({ codec_type: type }) => type === 'video') ?? [];
  const audios = probe.streams?.filter(({ codec_type: type }) => type === 'audio') ?? [];
  const durationSeconds = Number(probe.format?.duration ?? videos[0]?.duration);
  const width = Number(videos[0]?.width);
  const height = Number(videos[0]?.height);
  if (
    videos.length !== 1 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new Error(`The ${label} has invalid duration or video dimensions.`);
  }
  return {
    audioStreamCount: audios.length,
    durationSeconds: round(durationSeconds),
    privacyText: JSON.stringify({
      formatTags: probe.format?.tags ?? {},
      streamTags: probe.streams?.map(({ tags }) => tags ?? {}) ?? [],
    }),
    video: { height, width },
  };
}

function assertMediaContract({ comparisonProbe, editPlan, evaluation, previewProbe }) {
  const planDuration = editPlan.output.duration_seconds;
  const evaluatedDuration = evaluation.technicalComparison.agentDurationSeconds;
  if (
    previewProbe.video.width !== editPlan.output.width ||
    previewProbe.video.height !== editPlan.output.height
  ) {
    throw new Error('The probed preview dimensions do not match the frozen edit plan.');
  }
  if (
    Math.abs(previewProbe.durationSeconds - planDuration) > 0.02 ||
    Math.abs(previewProbe.durationSeconds - evaluatedDuration) > 0.02
  ) {
    throw new Error('The probed preview duration does not match the plan and evaluation.');
  }
  if (previewProbe.audioStreamCount !== 1) {
    throw new Error(
      'The source-only preview must contain exactly one synthetic guide-audio stream.',
    );
  }
  if (comparisonProbe.audioStreamCount !== 0) {
    throw new Error('The held-out comparison must not contain an audio stream.');
  }
  if (Math.abs(comparisonProbe.durationSeconds - previewProbe.durationSeconds) > 0.02) {
    throw new Error('The held-out comparison duration must match the source-only preview.');
  }
}

function deriveCatalogPreviewReferenceDuration(readLog) {
  for (const invocation of readLog.tool_invocations ?? []) {
    const summary = typeof invocation.result_summary === 'string' ? invocation.result_summary : '';
    const match = summary.match(/each preview was approximately (\d+(?:\.\d+)?) seconds/i);
    if (match) return Number(match[1]);
  }
  const exception = readLog.isolation_attestation?.network_exception ?? '';
  const fallback = exception.match(/(\d+(?:\.\d+)?)-second (?:catalog )?preview/i);
  if (fallback) return Number(fallback[1]);
  throw new Error('The frozen read log does not establish the catalog-preview reference duration.');
}

async function assertNoUnknownOutputs(root) {
  const allowed = new Set(OUTPUT_NAMES);
  const entries = await readdir(root, { withFileTypes: true });
  const unknown = entries.filter((entry) => !allowed.has(entry.name) || !entry.isFile());
  if (unknown.length) {
    throw new Error(
      `Blind-pilot output contains unknown or non-file entries: ${unknown
        .map(({ name }) => name)
        .sort()
        .join(', ')}`,
    );
  }
}

function assertExactOutputSet(files) {
  const expected = [...OUTPUT_NAMES].sort();
  const actual = [...files.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('The blind-pilot release did not produce the exact public output allowlist.');
  }
}

async function assertExactOutputDirectory(root, expectedFiles) {
  await assertNoUnknownOutputs(root);
  const entries = await readdir(root, { withFileTypes: true });
  const actual = entries.map(({ name }) => name).sort();
  const expected = [...expectedFiles.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('The blind-pilot output directory is missing an allowlisted release file.');
  }
  for (const [name, expectedBytes] of expectedFiles) {
    const actualBytes = await readFile(resolve(root, name));
    if (sha256(actualBytes) !== sha256(expectedBytes)) {
      throw new Error(`The written release bytes for ${name} failed verification.`);
    }
  }
}

function scanPublicOutputs(files, mediaMetadata) {
  const forbidden = [
    ['Windows absolute path', /(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/]/u],
    ['UNC path', /\\\\[^\\\r\n]+\\[^\\\r\n]+/u],
    ['Unix home or temporary path', /\/(?:Users|home|private|tmp|var\/tmp)\/[^\s"'<>]+/u],
    ['file URL', /file:\/\//iu],
    ['Downloads directory', /\bDownloads\b/u],
    ['workspace directory', /\bVSCode Projects\b/u],
    ['original camera filename', /\bIMG[_-]?\d{4,}\.(?:mov|mp4)\b/iu],
    ['opaque original filename', /\b[a-f0-9]{32}\.mp4\b/iu],
  ];
  for (const [name, bytes] of files) {
    const text = mediaMetadata.get(name) ?? bytes.toString('utf8');
    const finding = forbidden.find(([, pattern]) => pattern.test(text));
    if (finding) {
      throw new Error(`${name} failed the public privacy scan: ${finding[0]}.`);
    }
  }
}

function resolveInside(root, relativePath) {
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error('Release input escaped its root.');
  return path;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
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
