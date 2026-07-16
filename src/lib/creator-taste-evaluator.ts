import {
  TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
  type TargetSpecConsistencyReport,
  validateTargetSpecConsistencyReport,
} from './creator-taste-contracts.ts';

export const CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION =
  'nodevideo.creative-fidelity-input.v1' as const;
export const CREATIVE_FIDELITY_REPORT_SCHEMA_VERSION =
  'nodevideo.creative-fidelity-report.v1' as const;

export const CREATIVE_FIDELITY_GATE_IDS = [
  'provenance',
  'structural',
  'semantic-overlays',
  'layout',
  'visual-treatment',
  'creator-identity',
  'delivery',
] as const;

export type CreativeFidelityGateId = (typeof CREATIVE_FIDELITY_GATE_IDS)[number];

export const DEFAULT_CREATIVE_FIDELITY_THRESHOLDS: Readonly<
  Record<CreativeFidelityGateId, number>
> = Object.freeze({
  provenance: 1,
  structural: 0.95,
  'semantic-overlays': 0.8,
  layout: 0.8,
  'visual-treatment': 0.8,
  'creator-identity': 0.9,
  delivery: 0.95,
});

export interface CreativeFidelityGateEvidence {
  score: number;
  evidenceArtifactIds: string[];
  note: string;
}

export interface CreativeFidelityInput {
  schemaVersion: typeof CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION;
  candidateArtifactId: string;
  referenceAuditId: string;
  targetSpecConsistency: TargetSpecConsistencyReport;
  gates: Record<CreativeFidelityGateId, CreativeFidelityGateEvidence>;
}

export interface CreativeFidelityReport {
  schemaVersion: typeof CREATIVE_FIDELITY_REPORT_SCHEMA_VERSION;
  candidateArtifactId: string;
  referenceAuditId: string;
  status: 'pass' | 'fail' | 'invalid';
  conjunctive: true;
  score: number;
  gates: Array<{
    id: CreativeFidelityGateId;
    score: number;
    threshold: number;
    status: 'pass' | 'fail' | 'invalid';
    evidenceArtifactIds: string[];
    note: string;
  }>;
  blockingReasons: string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function evaluateCreativeFidelity(
  input: CreativeFidelityInput,
  thresholds: Readonly<
    Record<CreativeFidelityGateId, number>
  > = DEFAULT_CREATIVE_FIDELITY_THRESHOLDS,
): CreativeFidelityReport {
  validateCreativeFidelityInput(input);
  validateThresholds(thresholds);
  const targetSpecValid = input.targetSpecConsistency.status === 'pass';
  const gates = CREATIVE_FIDELITY_GATE_IDS.map((id) => ({
    id,
    score: input.gates[id].score,
    threshold: thresholds[id],
    status: targetSpecValid
      ? input.gates[id].score >= thresholds[id]
        ? ('pass' as const)
        : ('fail' as const)
      : ('invalid' as const),
    evidenceArtifactIds: [...input.gates[id].evidenceArtifactIds],
    note: input.gates[id].note,
  }));
  const failed = gates.filter((gate) => gate.status === 'fail');
  const status = !targetSpecValid ? 'invalid' : failed.length > 0 ? 'fail' : 'pass';
  const blockingReasons = !targetSpecValid
    ? [
        `Target-spec consistency is ${input.targetSpecConsistency.status}; creative fidelity cannot be adjudicated.`,
        ...input.targetSpecConsistency.blockingReasons,
      ]
    : failed.map(
        (gate) => `${gate.id} scored ${gate.score.toFixed(3)} below ${gate.threshold.toFixed(3)}.`,
      );
  return {
    schemaVersion: CREATIVE_FIDELITY_REPORT_SCHEMA_VERSION,
    candidateArtifactId: input.candidateArtifactId,
    referenceAuditId: input.referenceAuditId,
    status,
    conjunctive: true,
    score: Math.min(...gates.map((gate) => gate.score)),
    gates,
    blockingReasons,
  };
}

export function validateCreativeFidelityInput(
  value: unknown,
): asserts value is CreativeFidelityInput {
  assert(isRecord(value), 'CreativeFidelityInput must be an object.');
  assert(
    value.schemaVersion === CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION,
    'Unsupported creative fidelity input schema.',
  );
  assertId(value.candidateArtifactId, 'candidateArtifactId');
  assertId(value.referenceAuditId, 'referenceAuditId');
  validateTargetSpecConsistencyReport(value.targetSpecConsistency);
  assert(
    value.targetSpecConsistency.schemaVersion === TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
    'Target-spec consistency schema mismatch.',
  );
  assert(isRecord(value.gates), 'CreativeFidelityInput.gates must be an object.');
  assertExactKeys(value.gates, CREATIVE_FIDELITY_GATE_IDS, 'CreativeFidelityInput.gates');
  for (const id of CREATIVE_FIDELITY_GATE_IDS) validateGateEvidence(value.gates[id], id);
}

export function validateCreativeFidelityReport(
  value: unknown,
): asserts value is CreativeFidelityReport {
  assert(isRecord(value), 'CreativeFidelityReport must be an object.');
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'candidateArtifactId',
      'referenceAuditId',
      'status',
      'conjunctive',
      'score',
      'gates',
      'blockingReasons',
    ],
    'CreativeFidelityReport',
  );
  assert(
    value.schemaVersion === CREATIVE_FIDELITY_REPORT_SCHEMA_VERSION,
    'Unsupported creative fidelity report schema.',
  );
  assertId(value.candidateArtifactId, 'candidateArtifactId');
  assertId(value.referenceAuditId, 'referenceAuditId');
  assert(
    value.status === 'pass' || value.status === 'fail' || value.status === 'invalid',
    'CreativeFidelityReport.status is invalid.',
  );
  assert(value.conjunctive === true, 'Creative fidelity reports must be conjunctive.');
  assertUnit(value.score, 'CreativeFidelityReport.score');
  assert(
    Array.isArray(value.gates) && value.gates.length === CREATIVE_FIDELITY_GATE_IDS.length,
    'CreativeFidelityReport must contain every fidelity gate.',
  );
  const seen = new Set<string>();
  for (const [index, gate] of value.gates.entries()) {
    assert(isRecord(gate), `CreativeFidelityReport.gates[${index}] must be an object.`);
    assertExactKeys(
      gate,
      ['id', 'score', 'threshold', 'status', 'evidenceArtifactIds', 'note'],
      `CreativeFidelityReport.gates[${index}]`,
    );
    assert(
      CREATIVE_FIDELITY_GATE_IDS.includes(gate.id),
      `CreativeFidelityReport.gates[${index}].id is invalid.`,
    );
    assert(!seen.has(gate.id), `CreativeFidelityReport gate ${gate.id} is duplicated.`);
    seen.add(gate.id);
    assertUnit(gate.score, `${gate.id}.score`);
    assertUnit(gate.threshold, `${gate.id}.threshold`);
    assert(
      gate.status === 'pass' || gate.status === 'fail' || gate.status === 'invalid',
      `${gate.id}.status is invalid.`,
    );
    validateGateEvidence(
      {
        score: gate.score,
        evidenceArtifactIds: gate.evidenceArtifactIds,
        note: gate.note,
      },
      gate.id,
    );
  }
  assert(
    Array.isArray(value.blockingReasons) &&
      value.blockingReasons.every(
        (item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 2_000,
      ),
    'CreativeFidelityReport.blockingReasons is invalid.',
  );
  const computedStatus = value.gates.some((gate) => gate.status === 'invalid')
    ? 'invalid'
    : value.gates.some((gate) => gate.status === 'fail')
      ? 'fail'
      : 'pass';
  assert(
    value.status === computedStatus,
    'Creative fidelity status must reflect all gate statuses.',
  );
}

function validateGateEvidence(value: unknown, label: string): void {
  assert(isRecord(value), `${label} evidence must be an object.`);
  assertExactKeys(value, ['score', 'evidenceArtifactIds', 'note'], `${label} evidence`);
  assertUnit(value.score, `${label}.score`);
  assert(
    Array.isArray(value.evidenceArtifactIds) && value.evidenceArtifactIds.length > 0,
    `${label}.evidenceArtifactIds must not be empty.`,
  );
  const seen = new Set<string>();
  value.evidenceArtifactIds.forEach((id, index) => {
    assertId(id, `${label}.evidenceArtifactIds[${index}]`);
    assert(!seen.has(id), `${label}.evidenceArtifactIds contains a duplicate.`);
    seen.add(id);
  });
  assert(
    typeof value.note === 'string' && value.note.trim().length > 0 && value.note.length <= 2_000,
    `${label}.note is invalid.`,
  );
}

function validateThresholds(value: Readonly<Record<CreativeFidelityGateId, number>>): void {
  assert(isRecord(value), 'Creative fidelity thresholds must be an object.');
  assertExactKeys(value, CREATIVE_FIDELITY_GATE_IDS, 'Creative fidelity thresholds');
  for (const id of CREATIVE_FIDELITY_GATE_IDS) assertUnit(value[id], `${id} threshold`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  for (const key of keys) assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  for (const key of Object.keys(value))
    assert(expected.has(key), `${label}.${key} is not allowed.`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && ID_PATTERN.test(value), `${label} is invalid.`);
}

function assertUnit(value: unknown, label: string): asserts value is number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
    `${label} must be between zero and one.`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
