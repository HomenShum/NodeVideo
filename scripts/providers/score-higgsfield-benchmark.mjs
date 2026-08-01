import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scoreProviderBenchmark } from '../../src/lib/provider-benchmark.ts';
import { writeJson } from '../media/media-proof-lib.mjs';

const source = resolve(process.argv[2] ?? '.qa/evidence/higgsfield/benchmark-results.json');
const destination = resolve(process.argv[3] ?? '.qa/evidence/higgsfield/benchmark-report.json');
const payload = JSON.parse(await readFile(source, 'utf8'));
if (
  payload.schemaVersion !== 'nodevideo.provider-benchmark-results.v1' ||
  !Array.isArray(payload.results)
) {
  throw new Error('Expected nodevideo.provider-benchmark-results.v1 with a results array');
}
await writeJson(destination, scoreProviderBenchmark(payload.results));
console.log(destination);
