export type RateEstimate = {
  numerator: number;
  denominator: number;
  rate: number;
  confidenceInterval: { lower: number; upper: number; level: 0.95 };
};

export function wilsonRate(numerator: number, denominator: number): RateEstimate {
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    denominator < 0 ||
    numerator < 0 ||
    numerator > denominator
  ) {
    throw new Error(
      'Rate counts must be non-negative integers with numerator no larger than denominator.',
    );
  }
  if (denominator === 0)
    return {
      numerator,
      denominator,
      rate: 0,
      confidenceInterval: { lower: 0, upper: 1, level: 0.95 },
    };
  const z = 1.959963984540054;
  const p = numerator / denominator;
  const z2 = z * z;
  const centre = (p + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const margin =
    (z / (1 + z2 / denominator)) * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator);
  return {
    numerator,
    denominator,
    rate: p,
    confidenceInterval: {
      lower: Math.max(0, centre - margin),
      upper: Math.min(1, centre + margin),
      level: 0.95,
    },
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function cohensKappa(left: string[], right: string[]): number | null {
  if (left.length !== right.length || left.length === 0) return null;
  const labels = new Set([...left, ...right]);
  const observed = left.filter((value, index) => value === right[index]).length / left.length;
  let expected = 0;
  for (const label of labels)
    expected +=
      (left.filter((value) => value === label).length / left.length) *
      (right.filter((value) => value === label).length / right.length);
  return expected === 1 ? (observed === 1 ? 1 : 0) : (observed - expected) / (1 - expected);
}
