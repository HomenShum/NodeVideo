#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_SCHEMA = 'nodevideo.creator-taste-profile.v1';
const AUDIT_SCHEMA = 'nodevideo.production-audit.v1';
const CONSISTENCY_SCHEMA = 'nodevideo.target-spec-consistency.v1';
const RUN_SCHEMA = 'nodevideo.creator-taste-run.v1';
const ROLES = [
  'hook',
  'commentary',
  'instruction',
  'lyric',
  'identity',
  'cta',
  'end-card',
  'other',
];

export function adaptProductionAudit(input, options = {}) {
  if (input?.schemaVersion === AUDIT_SCHEMA) return structuredClone(input);
  if (input?.schemaVersion !== 'nodevideo.private-style-gap-audit.v1') {
    throw new Error(`Unsupported production audit schema: ${String(input?.schemaVersion)}`);
  }

  const id = options.id ?? 'production.legacy-audit';
  const durationMs = Math.round(input.durationSeconds * 1_000);
  const textCues = (input.targetOcr ?? []).map((cue) => {
    const text = normalizeText(cue.normalizedText);
    return {
      text,
      role: inferCueRole(text, cue.firstSeconds, cue.lastSeconds, input.durationSeconds),
      startMs: Math.max(0, Math.round(cue.firstSeconds * 1_000)),
      endMs: Math.min(
        durationMs,
        Math.max(1, Math.round((cue.lastSeconds + input.sampleCadenceSeconds) * 1_000)),
      ),
      confidence: clamp(cue.maxConfidence ?? 0.5),
      region: sanitizeRegion(cue.medianBox),
    };
  });
  const planDeltas = input.overlayPlanDeltas ?? [];
  const claimedZones = unique(planDeltas.map((item) => zoneForY(item.targetPlanY ?? 0.5)));
  const claimedRoles = unique(
    planDeltas.map((item) => (String(item.id).includes('lyric') ? 'lyric' : 'other')),
  );

  const audit = {
    schemaVersion: AUDIT_SCHEMA,
    id,
    createdAt: options.createdAt ?? new Date().toISOString(),
    durationMs,
    contentKind: options.contentKind ?? 'other',
    evidenceArtifactIds: [`evidence.${id}.style-gap`],
    observations: {
      textCues,
      cuts: (input.sourceAndCutDeltas ?? []).slice(1).map((item, index) => ({
        frame: Math.max(0, index + 1),
        confidence: Math.abs(item.timelineStartDeltaFrames ?? 0) <= 2 ? 0.95 : 0.6,
      })),
      visualTreatment: {
        lumaMean: clamp255(input.summary?.targetLumaMean),
        lumaStd: clamp255(input.summary?.targetLumaStd),
        saturationMean: clamp255(input.summary?.targetSaturationMean),
      },
    },
    claimedTargetSpec: {
      overlayCount: planDeltas.length,
      roles: claimedRoles,
      persistentIdentity: false,
      endCard: false,
      visualTreatmentDescribed: false,
      verticalZones: claimedZones,
    },
  };
  if (options.deriveTargetSpec === true) {
    audit.claimedTargetSpec = deriveTargetSpecFromEvidence(audit);
  }
  return audit;
}

/** Rebuild a target interpretation from visible evidence rather than a stale edit plan. */
export function deriveTargetSpecFromEvidence(audit) {
  const cues = audit.observations.textCues.filter((cue) => cue.confidence >= 0.45);
  return {
    overlayCount: cues.length,
    roles: unique(cues.map((cue) => cue.role)),
    persistentIdentity: hasPersistentIdentity(audit),
    endCard: hasEndCard(audit),
    visualTreatmentDescribed: audit.observations.visualTreatment !== undefined,
    verticalZones: unique(cues.map((cue) => zoneForY(cue.region.y + cue.region.height / 2))),
  };
}

export function learnCreatorTaste(audits, options = {}) {
  if (!Array.isArray(audits) || audits.length === 0)
    throw new Error('At least one audit is required.');
  const learnedAt = options.learnedAt ?? new Date().toISOString();
  const count = audits.length;
  const evidence = (suffix) => audits.map((audit) => `evidence.${audit.id}.${suffix}`);
  const confidence = confidenceForProductions(count);
  const cues = audits.flatMap((audit) =>
    audit.observations.textCues.map((cue) => ({ audit, cue })),
  );
  const cuesPerMinute = mean(
    audits.map((audit) => audit.observations.textCues.length / (audit.durationMs / 60_000)),
  );
  const rate = (predicate) => fraction(audits, predicate);
  const cueRoleRate = (role) => fraction(cues, ({ cue }) => cue.role === role);
  const rolesByCount = ROLES.map((role) => ({
    role,
    count: cues.filter(({ cue }) => cue.role === role).length,
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

  const roleZones = rolesByCount.map(({ role, count: samples }) => {
    const roleCues = cues.filter(({ cue }) => cue.role === role);
    const counts = new Map(['top', 'middle', 'bottom'].map((zone) => [zone, 0]));
    for (const { cue } of roleCues) {
      const zone = zoneForY(cue.region.y + cue.region.height / 2);
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
    const [zone, zoneSamples] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { role, zone, confidence: round(zoneSamples / samples), samples };
  });

  const identityCues = cues.filter(({ cue }) => cue.role === 'identity');
  const identityTokens = unique(identityCues.map(({ cue }) => cue.text.toLowerCase())).sort();
  const identityZones = identityCues.map(({ cue }) =>
    zoneForY(cue.region.y + cue.region.height / 2),
  );
  const spatialGrammar = { roleZones };
  if (identityZones.length > 0) {
    const zone = mode(identityZones);
    spatialGrammar.persistentIdentityZone = supported(
      zone,
      unique(identityCues.map(({ audit }) => audit.id)).length,
      fraction(identityZones, (item) => item === zone),
      evidence('identity-layout'),
    );
  }

  const visuals = audits.filter((audit) => audit.observations.visualTreatment);
  const profile = {
    schemaVersion: PROFILE_SCHEMA,
    id: options.profileId ?? 'creator-taste.learned',
    learnedAt,
    sourceProductionIds: audits.map((audit) => audit.id),
    applicableContentKinds: unique(audits.map((audit) => audit.contentKind)),
    confidence: round(confidence),
    editorialAttention: {
      textCuesPerMinute: supported(round(cuesPerMinute), count, confidence, evidence('text-cues')),
      hookInFirstThreeSecondsRate: supported(
        round(
          rate((audit) =>
            audit.observations.textCues.some((cue) => cue.startMs < 3_000 && cue.role === 'hook'),
          ),
        ),
        count,
        confidence,
        evidence('opening-hook'),
      ),
      endCardRate: supported(round(rate(hasEndCard)), count, confidence, evidence('end-card')),
      preferredCueRoles: supported(
        rolesByCount.map(({ role }) => role),
        count,
        confidence,
        evidence('cue-roles'),
      ),
    },
    creatorVoice: {
      commentaryRate: supported(
        round(cueRoleRate('commentary')),
        count,
        confidence,
        evidence('commentary'),
      ),
      instructionRate: supported(
        round(cueRoleRate('instruction')),
        count,
        confidence,
        evidence('instruction'),
      ),
      lyricRate: supported(round(cueRoleRate('lyric')), count, confidence, evidence('lyric')),
      ctaRate: supported(
        round(cueRoleRate('cta') + cueRoleRate('end-card')),
        count,
        confidence,
        evidence('cta'),
      ),
    },
    spatialGrammar,
    distributionIdentity: {
      persistentIdentityRate: supported(
        round(rate(hasPersistentIdentity)),
        count,
        confidence,
        evidence('persistent-identity'),
      ),
      identityTokens: supported(
        identityTokens,
        Math.max(1, unique(identityCues.map(({ audit }) => audit.id)).length),
        identityCues.length > 0 ? confidence : 0,
        evidence('identity-token'),
      ),
    },
    cautions: [],
  };
  if (visuals.length > 0) {
    const visualConfidence = confidenceForProductions(visuals.length);
    profile.visualWorld = {
      lumaMean: supported(
        round(mean(visuals.map((a) => a.observations.visualTreatment.lumaMean))),
        visuals.length,
        visualConfidence,
        evidence('luma'),
      ),
      lumaStd: supported(
        round(mean(visuals.map((a) => a.observations.visualTreatment.lumaStd))),
        visuals.length,
        visualConfidence,
        evidence('contrast'),
      ),
      saturationMean: supported(
        round(mean(visuals.map((a) => a.observations.visualTreatment.saturationMean))),
        visuals.length,
        visualConfidence,
        evidence('saturation'),
      ),
    };
  }
  if (count < 3)
    profile.cautions.push(
      'Profile is provisional until at least three independent productions support it.',
    );
  if (unique(audits.map((audit) => audit.contentKind)).length === 1) {
    profile.cautions.push(
      'Content-kind transfer is unproven; preserve domain-neutral traits and revalidate pacing per format.',
    );
  }
  if (visuals.length < count)
    profile.cautions.push('Some productions lack visual-treatment measurements.');
  return profile;
}

export function evaluateTargetSpecConsistency(audit) {
  const spec = audit.claimedTargetSpec;
  if (!spec) {
    return {
      schemaVersion: CONSISTENCY_SCHEMA,
      auditId: audit.id,
      status: 'insufficient-evidence',
      score: 0,
      checks: [
        check(
          'target-spec-present',
          'insufficient-evidence',
          'No claimed spec',
          'Missing',
          'A target interpretation must be supplied before fidelity evaluation.',
        ),
      ],
      blockingReasons: [],
    };
  }
  const cues = audit.observations.textCues.filter((cue) => cue.confidence >= 0.45);
  const observedRoles = unique(cues.map((cue) => cue.role));
  const observedZones = unique(cues.map((cue) => zoneForY(cue.region.y + cue.region.height / 2)));
  const observedIdentity = hasPersistentIdentity(audit);
  const observedEndCard = hasEndCard(audit);
  const checks = [];
  const countRatio =
    Math.min(spec.overlayCount, cues.length) /
    Math.max(1, Math.max(spec.overlayCount, cues.length));
  checks.push(
    check(
      'ocr-overlay-coverage',
      countRatio >= 0.75 ? 'pass' : 'fail',
      `${cues.length} OCR cue groups`,
      `${spec.overlayCount} overlays`,
      countRatio >= 0.75
        ? 'The spec explains the observed overlay cardinality.'
        : 'The spec does not explain enough of the visible OCR groups.',
    ),
  );
  const missingRoles = observedRoles.filter((role) => !spec.roles.includes(role));
  checks.push(
    check(
      'semantic-overlay-roles',
      missingRoles.length === 0 ? 'pass' : 'fail',
      observedRoles.join(', ') || 'none',
      spec.roles.join(', ') || 'none',
      missingRoles.length === 0
        ? 'Observed cue roles are represented.'
        : `Missing observed roles: ${missingRoles.join(', ')}.`,
    ),
  );
  checks.push(
    booleanCheck(
      'persistent-creator-identity',
      observedIdentity,
      spec.persistentIdentity,
      'Persistent branding must be explicit in the target spec.',
    ),
  );
  checks.push(
    booleanCheck(
      'end-card',
      observedEndCard,
      spec.endCard,
      'The distribution end-card must be explicit in the target spec.',
    ),
  );
  checks.push(
    check(
      'visual-treatment',
      audit.observations.visualTreatment && !spec.visualTreatmentDescribed ? 'fail' : 'pass',
      audit.observations.visualTreatment ? 'Measured grade statistics' : 'No grade evidence',
      spec.visualTreatmentDescribed ? 'Grade described' : 'Grade omitted',
      audit.observations.visualTreatment && !spec.visualTreatmentDescribed
        ? 'Observed luma, contrast, and saturation are not explained by the spec.'
        : 'Visual treatment evidence and spec agree.',
    ),
  );
  const missingZones = observedZones.filter((zone) => !spec.verticalZones.includes(zone));
  checks.push(
    check(
      'layout-zones',
      missingZones.length === 0 ? 'pass' : 'fail',
      observedZones.join(', ') || 'none',
      spec.verticalZones.join(', ') || 'none',
      missingZones.length === 0
        ? 'Observed vertical zones are represented.'
        : `Missing observed zones: ${missingZones.join(', ')}.`,
    ),
  );
  const failures = checks.filter((item) => item.status === 'fail');
  return {
    schemaVersion: CONSISTENCY_SCHEMA,
    auditId: audit.id,
    status: failures.length > 0 ? 'fail' : 'pass',
    score: round(checks.filter((item) => item.status === 'pass').length / checks.length),
    checks,
    blockingReasons: failures.map((item) => item.message),
  };
}

function inferCueRole(text, firstSeconds, lastSeconds, durationSeconds) {
  const normalized = text.toLowerCase();
  const lifetime = lastSeconds - firstSeconds;
  if (/@|(?:^|\b)[a-z]?shumhomen\b/.test(normalized) || lifetime >= durationSeconds * 0.35)
    return 'identity';
  if (
    firstSeconds >= durationSeconds * 0.6 &&
    /(thanks|watching|follow|subscribe|more)/.test(normalized)
  )
    return 'end-card';
  if (/(follow|subscribe|save|share|comment|link in bio)/.test(normalized)) return 'cta';
  if (firstSeconds < 3 && /(sign|practice|how to|pov|when|watch)/.test(normalized)) return 'hook';
  if (/(left|right|head|chest|sharp|clean|relax|tick|flip|step|turn|hold)/.test(normalized))
    return 'instruction';
  return 'commentary';
}

function hasPersistentIdentity(audit) {
  return audit.observations.textCues.some(
    (cue) => cue.role === 'identity' && cue.endMs - cue.startMs >= audit.durationMs * 0.3,
  );
}

function hasEndCard(audit) {
  return audit.observations.textCues.some(
    (cue) => cue.role === 'end-card' && cue.startMs >= audit.durationMs * 0.6,
  );
}

function booleanCheck(id, observed, claimed, message) {
  return check(
    id,
    observed === claimed ? 'pass' : 'fail',
    String(observed),
    String(claimed),
    observed === claimed
      ? `${message} Observed and claimed values agree.`
      : `${message} Observed ${observed}, claimed ${claimed}.`,
  );
}

function check(id, status, observed, claimed, message) {
  return { id, status, observed, claimed, message };
}

function supported(value, supportProductions, confidence, evidenceRefs) {
  return { value, supportProductions, confidence: round(confidence), evidenceRefs };
}

function confidenceForProductions(count) {
  return Math.min(0.95, 0.45 + Math.max(0, count - 1) * 0.15);
}

function normalizeText(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return text || '[unreadable text]';
}

function sanitizeRegion(box = {}) {
  const x = clamp(box.x ?? 0);
  const y = clamp(box.y ?? 0);
  const width = Math.max(0.000001, Math.min(clamp(box.width ?? 0.1), 1 - x));
  const height = Math.max(0.000001, Math.min(clamp(box.height ?? 0.05), 1 - y));
  return { x, y, width, height };
}

function zoneForY(y) {
  if (y < 1 / 3) return 'top';
  if (y < 2 / 3) return 'middle';
  return 'bottom';
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fraction(values, predicate) {
  return values.length === 0 ? 0 : values.filter(predicate).length / values.length;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
  )[0][0];
}

function unique(values) {
  return [...new Set(values)];
}

function clamp(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clamp255(value) {
  return Math.min(255, Math.max(0, Number.isFinite(value) ? value : 0));
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function usage() {
  return 'Usage: node scripts/analysis/creator-taste-profiler.mjs --input audit.json [--input audit2.json] --out result.json [--profile-id id] [--content-kind dance|talking-head|tutorial|comedy|montage|other] [--derive-target-spec]';
}

async function main(argv) {
  const inputs = [];
  let output;
  let profileId = 'creator-taste.learned';
  let contentKind = 'other';
  let deriveTargetSpec = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') inputs.push(argv[++index]);
    else if (argument === '--out') output = argv[++index];
    else if (argument === '--profile-id') profileId = argv[++index];
    else if (argument === '--content-kind') contentKind = argv[++index];
    else if (argument === '--derive-target-spec') deriveTargetSpec = true;
    else if (argument === '--help') {
      console.log(usage());
      return;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (inputs.length === 0 || !output) throw new Error(usage());
  const generatedAt = new Date().toISOString();
  const audits = [];
  for (const inputPath of inputs) {
    const parsed = JSON.parse(await readFile(inputPath, 'utf8'));
    const basename = path
      .basename(inputPath, path.extname(inputPath))
      .replace(/[^A-Za-z0-9._:-]+/g, '-');
    audits.push(
      adaptProductionAudit(parsed, {
        id: parsed.id ?? `production.${basename}`,
        createdAt: parsed.createdAt ?? generatedAt,
        contentKind: parsed.contentKind ?? contentKind,
        deriveTargetSpec,
      }),
    );
  }
  const result = {
    schemaVersion: RUN_SCHEMA,
    generatedAt,
    profile: learnCreatorTaste(audits, { profileId, learnedAt: generatedAt }),
    audits,
    consistencyReports: audits.map(evaluateTargetSpecConsistency),
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Creator taste profile written to ${output}`);
  for (const report of result.consistencyReports) {
    console.log(`${report.auditId}: target-spec ${report.status} (${report.score})`);
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
