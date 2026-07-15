import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(import.meta.dirname, '..', '..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(resolve(root, path)))
    .digest('hex');

const tutorialInputSchema = await readJson('packs/tutorial-compare/input.schema.json');
const tutorialOutputSchema = await readJson('packs/tutorial-compare/output.schema.json');
const tutorialEvaluation = await readJson('packs/tutorial-compare/evals/public-worker-v1.json');
const tutorialResult = await readJson('fixtures/media/tutorial-compare-v1/result.json');
const tutorialReceipt = await readJson('fixtures/media/tutorial-compare-v1/receipt.json');

const authorizedInputSchema = await readJson('packs/reference-reconstruct/input.schema.json');
const authorizedOutputSchema = await readJson('packs/reference-reconstruct/output.schema.json');
const authorizedEvaluation = await readJson(
  'packs/reference-reconstruct/evals/authorized-real-v1.json',
);
const authorizedCase = await readJson('fixtures/media/authorized-real-v1/case-manifest.json');
const authorizedResult = await readJson('fixtures/media/authorized-real-v1/result.json');
const authorizedReceipt = await readJson('fixtures/media/authorized-real-v1/receipt.json');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const tutorialInputValid = ajv.compile(tutorialInputSchema)(tutorialEvaluation.cases[0].input);
const tutorialOutputValidator = ajv.compile(tutorialOutputSchema);
const tutorialOutputValid = tutorialOutputValidator(tutorialResult);

const authorizedInputValidator = ajv.compile(authorizedInputSchema);
const authorizedInput = authorizedEvaluation.cases[0].input;
const authorizedInputValid = authorizedInputValidator(authorizedInput);
const authorizedOutputValidator = ajv.compile(authorizedOutputSchema);
const authorizedOutputValid = authorizedOutputValidator(authorizedResult);

const sameMembers = (left, right) =>
  left.length === right.length && left.every((value) => right.includes(value));
const allAssertionsPass = (assertions) =>
  assertions.length > 0 && assertions.every((assertion) => assertion.pass === true);

const expectedRenderSourceIds = [
  authorizedInput.assets.sourceA.assetId,
  authorizedInput.assets.sourceB.assetId,
];
const targetAssetId = authorizedInput.assets.target.assetId;
const expectedEvaluationSourceIds = [targetAssetId, 'artifact.reconstruction'];
const expectedClaimTier = authorizedEvaluation.cases[0].observed.claimTier;

const authorizedGraphicHashesMatch = (
  await Promise.all(
    authorizedInput.assets.graphics.map(async (graphic) => {
      const assetPath = `packs/reference-reconstruct/assets/${basename(graphic.locator.value)}`;
      return (
        graphic.locator.kind === 'pack-asset-id' && (await digest(assetPath)) === graphic.sha256
      );
    }),
  )
).every(Boolean);

const tutorialChecks = [
  ['public eval input matches its schema', tutorialInputValid],
  ['worker result matches its schema', tutorialOutputValid],
  [
    'worker result hash matches eval',
    (await digest(tutorialEvaluation.proof.resultPath)) === tutorialEvaluation.proof.resultSha256,
  ],
  [
    'worker receipt hash matches eval',
    (await digest(tutorialEvaluation.proof.receiptPath)) === tutorialEvaluation.proof.receiptSha256,
  ],
  [
    'receipt is a passed public worker run',
    tutorialReceipt.boundary === 'public-worker' && tutorialReceipt.validation.passed,
  ],
  [
    'eval disclaims production Convex',
    tutorialEvaluation.cases[0].doesNotProve.includes('durable Convex control-plane activation'),
  ],
];

const authorizedChecks = [
  ['authorized eval input matches its schema', authorizedInputValid],
  ['authorized worker result matches its schema', authorizedOutputValid],
  [
    'authorized case manifest hash matches eval',
    (await digest(authorizedEvaluation.proof.caseManifestPath)) ===
      authorizedEvaluation.proof.caseManifestSha256,
  ],
  [
    'authorized result hash matches eval',
    (await digest(authorizedEvaluation.proof.resultPath)) ===
      authorizedEvaluation.proof.resultSha256,
  ],
  [
    'authorized receipt hash matches eval',
    (await digest(authorizedEvaluation.proof.receiptPath)) ===
      authorizedEvaluation.proof.receiptSha256,
  ],
  ['authorized graphic hashes match eval', authorizedGraphicHashesMatch],
  [
    'authorization is explicit and source metadata stays unpublished',
    authorizedEvaluation.fixturePolicy.ownerAuthorizedPublication === true &&
      authorizedInput.authorization.ownerAuthorized === true &&
      authorizedInput.authorization.sourceContainerMetadataPublished === false &&
      authorizedCase.authorization.status === 'owner-authorized-publication' &&
      authorizedCase.authorization.sourceContainerMetadataPublished === false &&
      authorizedReceipt.authorization.status === 'owner-authorized-publication' &&
      authorizedReceipt.authorization.sourceContainerMetadataPublished === false,
  ],
  [
    'render lineage contains both MOV sources and excludes the target',
    sameMembers(authorizedResult.renderSourceAssetIds, expectedRenderSourceIds) &&
      sameMembers(authorizedReceipt.lineage.renderInputAssetIds, expectedRenderSourceIds) &&
      !authorizedResult.renderSourceAssetIds.includes(targetAssetId) &&
      !authorizedReceipt.lineage.renderInputAssetIds.includes(targetAssetId) &&
      authorizedReceipt.lineage.graphics === 'independently recreated SVG overlays',
  ],
  [
    'evaluation lineage contains the target and reconstruction only',
    sameMembers(authorizedResult.evaluationSourceAssetIds, expectedEvaluationSourceIds) &&
      sameMembers(authorizedReceipt.lineage.evaluationInputAssetIds, expectedEvaluationSourceIds),
  ],
  [
    'target is disclosed as analysis and evaluation only',
    authorizedInput.assets.target.usage === 'analysis-and-evaluation-only' &&
      authorizedCase.targetUsage === 'analysis-and-evaluation-only' &&
      authorizedResult.targetUsage === 'analysis-and-evaluation-only' &&
      authorizedResult.inputs.target.usage === 'analysis-and-evaluation-only' &&
      authorizedReceipt.inputs.target.usage === 'analysis-and-evaluation-only' &&
      authorizedReceipt.lineage.targetUsage === 'analysis-and-evaluation-only',
  ],
  [
    'target soundtrack is disclosed as unmatched and uncopied',
    authorizedInput.options.copyTargetAudio === false &&
      authorizedCase.metrics.targetAudioMatched === false &&
      authorizedResult.evaluation.targetAudioMatched === false &&
      authorizedReceipt.evaluation.targetAudioMatched === false &&
      authorizedReceipt.lineage.audio.targetMatched === false &&
      authorizedReceipt.lineage.audio.targetCopied === false &&
      authorizedResult.evaluation.sourceAudioMode === 'cut source audio with silent branded tail' &&
      authorizedReceipt.evaluation.sourceAudioMode ===
        'cut source audio with silent branded tail' &&
      authorizedCase.limitations.some((limitation) =>
        limitation.toLowerCase().includes('soundtrack is unmatched'),
      ) &&
      authorizedResult.limitations.some((limitation) =>
        limitation.toLowerCase().includes('soundtrack is not present'),
      ),
  ],
  [
    'authorized claim tier is successful and consistently disclosed',
    expectedClaimTier === 'perceptually-close-video' &&
      authorizedEvaluation.status === 'authorized-real-case-validated' &&
      authorizedEvaluation.proof.workerResult.status === 'completed' &&
      authorizedEvaluation.proof.workerResult.claimTier === expectedClaimTier &&
      authorizedCase.claimTier === expectedClaimTier &&
      authorizedResult.status === 'completed' &&
      authorizedResult.validation.passed === true &&
      allAssertionsPass(authorizedResult.validation.structuralAssertions) &&
      authorizedResult.validation.claimTier === expectedClaimTier &&
      authorizedReceipt.validation.passed === true &&
      allAssertionsPass(authorizedReceipt.validation.structuralAssertions) &&
      authorizedReceipt.validation.claimTier === expectedClaimTier,
  ],
];

const checks = [...tutorialChecks, ...authorizedChecks];

for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
if (checks.some(([, passed]) => !passed)) {
  if (!tutorialOutputValid) console.error(tutorialOutputValidator.errors);
  if (!authorizedInputValid) console.error(authorizedInputValidator.errors);
  if (!authorizedOutputValid) console.error(authorizedOutputValidator.errors);
  process.exitCode = 1;
}
