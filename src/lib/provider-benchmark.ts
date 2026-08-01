export const PROVIDER_BENCHMARK_RESULT_SCHEMA = 'nodevideo.provider-benchmark-results.v1' as const;

export type ProviderBenchmarkScore = {
  promptAdherence: number;
  identityConsistency: number;
  temporalConsistency: number;
  cameraQuality: number;
  humanAnatomy: number;
  textFidelity: number;
  brandFit: number;
  editability: number;
  artifactRate: number;
};

export type ProviderBenchmarkResult = {
  caseId: string;
  briefId: string;
  model: string;
  repetition: number;
  scores: ProviderBenchmarkScore;
  outputReceiptId: string;
  evaluatorId: string;
  notes?: string[];
};

const qualityDimensions: Array<Exclude<keyof ProviderBenchmarkScore, 'artifactRate'>> = [
  'promptAdherence',
  'identityConsistency',
  'temporalConsistency',
  'cameraQuality',
  'humanAnatomy',
  'textFidelity',
  'brandFit',
  'editability',
];
const allDimensions: Array<keyof ProviderBenchmarkScore> = [...qualityDimensions, 'artifactRate'];

function assertScore(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
}

export function validateProviderBenchmarkResult(result: ProviderBenchmarkResult) {
  if (!result.caseId || !result.briefId || !result.model || !result.outputReceiptId) {
    throw new Error('Benchmark results require case, brief, model, and output receipt IDs');
  }
  if (!Number.isInteger(result.repetition) || result.repetition < 1) {
    throw new Error('Benchmark repetition must be a positive integer');
  }
  for (const [dimension, value] of Object.entries(result.scores)) assertScore(value, dimension);
  return result;
}

export function scoreProviderBenchmark(
  results: ProviderBenchmarkResult[],
  requiredRepetitions = 3,
) {
  const validated = results.map(validateProviderBenchmarkResult);
  const groups = new Map<string, ProviderBenchmarkResult[]>();
  for (const result of validated) {
    const key = `${result.briefId}\u0000${result.model}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const rows = [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) throw new Error('Unexpected empty benchmark group');
    const repetitions = new Set(group.map((item) => item.repetition)).size;
    const dimensions = Object.fromEntries(
      allDimensions.map((dimension) => [
        dimension,
        average(group.map((item) => item.scores[dimension])),
      ]),
    ) as Record<keyof ProviderBenchmarkScore, number>;
    const quality = average(qualityDimensions.map((dimension) => dimensions[dimension]));
    const adjustedScore = quality * (1 - dimensions.artifactRate / 100);
    return {
      briefId: first.briefId,
      model: first.model,
      repetitions,
      complete: repetitions >= requiredRepetitions,
      dimensions,
      quality,
      adjustedScore,
      receiptIds: group.map((item) => item.outputReceiptId),
    };
  });
  const routing = [...new Set(rows.map((row) => row.briefId))].map((briefId) => {
    const eligible = rows
      .filter((row) => row.briefId === briefId && row.complete)
      .sort((a, b) => b.adjustedScore - a.adjustedScore);
    return { briefId, selectedModel: eligible[0]?.model ?? null, candidates: eligible };
  });
  return {
    schemaVersion: 'nodevideo.provider-benchmark-report.v1',
    requiredRepetitions,
    rows,
    routing,
    limitations: [
      'Routing is per brief; this report intentionally does not declare one universal winning model.',
      'Human or protected evaluator scores require receipt-backed outputs and cannot be inferred from provider status.',
    ],
  };
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
