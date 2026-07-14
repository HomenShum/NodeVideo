import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(import.meta.dirname, '..', '..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(resolve(root, path)))
    .digest('hex');

const inputSchema = await readJson('packs/tutorial-compare/input.schema.json');
const outputSchema = await readJson('packs/tutorial-compare/output.schema.json');
const evaluation = await readJson('packs/tutorial-compare/evals/public-worker-v1.json');
const result = await readJson('fixtures/media/tutorial-compare-v1/result.json');
const receipt = await readJson('fixtures/media/tutorial-compare-v1/receipt.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const inputValid = ajv.compile(inputSchema)(evaluation.cases[0].input);
const outputValidator = ajv.compile(outputSchema);
const outputValid = outputValidator(result);
const checks = [
  ['public eval input matches its schema', inputValid],
  ['worker result matches its schema', outputValid],
  [
    'worker result hash matches eval',
    (await digest(evaluation.proof.resultPath)) === evaluation.proof.resultSha256,
  ],
  [
    'worker receipt hash matches eval',
    (await digest(evaluation.proof.receiptPath)) === evaluation.proof.receiptSha256,
  ],
  [
    'receipt is a passed public worker run',
    receipt.boundary === 'public-worker' && receipt.validation.passed,
  ],
  [
    'eval disclaims production Convex',
    evaluation.cases[0].doesNotProve.includes('durable Convex control-plane activation'),
  ],
];

for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
if (checks.some(([, passed]) => !passed)) {
  if (!outputValid) console.error(outputValidator.errors);
  process.exitCode = 1;
}
