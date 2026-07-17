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

const groundingManifest = await readJson('packs/embodied-grounding/manifest.json');
const groundingInputSchema = await readJson('packs/embodied-grounding/input.schema.json');
const groundingOutputSchema = await readJson('packs/embodied-grounding/output.schema.json');
const groundingEvaluation = await readJson('packs/embodied-grounding/evals/replay-v1.json');
const groundingReplayResult = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/grounding-receipt.json',
);

const tasteManifest = await readJson('packs/creator-taste-audit/manifest.json');
const tasteInputSchema = await readJson('packs/creator-taste-audit/input.schema.json');
const tasteOutputSchema = await readJson('packs/creator-taste-audit/output.schema.json');
const tasteEvaluation = await readJson('packs/creator-taste-audit/evals/replay-v1.json');

const songManifest = await readJson('packs/song-conditioned-auto-edit/manifest.json');
const songInputSchema = await readJson('packs/song-conditioned-auto-edit/input.schema.json');
const songOutputSchema = await readJson('packs/song-conditioned-auto-edit/output.schema.json');
const songEvaluation = await readJson('packs/song-conditioned-auto-edit/evals/replay-v1.json');
const attentionManifest = await readJson('packs/attention-overlays/manifest.json');
const attentionInputSchema = await readJson('packs/attention-overlays/input.schema.json');
const attentionOutputSchema = await readJson('packs/attention-overlays/output.schema.json');
const attentionEvaluation = await readJson('packs/attention-overlays/evals/contract-v1.json');
const coachManifest = await readJson('packs/choreography-coach/manifest.json');
const coachInputSchema = await readJson('packs/choreography-coach/input.schema.json');
const coachOutputSchema = await readJson('packs/choreography-coach/output.schema.json');
const coachCalibrationManifestSchema = await readJson(
  'packs/choreography-coach/calibration-manifest.schema.json',
);
const coachCalibrationReportSchema = await readJson(
  'packs/choreography-coach/calibration-report.schema.json',
);
const songAnalysis = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/understanding.json',
);
const songPlan = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/song-conditioned-plan.json',
);
const songFreeze = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/choreography-freeze.json',
);
const songReadLog = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/generation-read-log.json',
);
const songReplayManifest = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/manifest.json',
);
const songReplayEvaluation = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/evaluator-report.json',
);
const songFreezeReceipt = await readJson(
  'fixtures/media/song-conditioned-auto-edit-v1/freeze-receipt.json',
);

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

const groundingInputValidator = ajv.compile(groundingInputSchema);
const groundingInputValid = groundingInputValidator(groundingEvaluation.cases[0].input);
const groundingResultValidator = ajv.compile({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: groundingOutputSchema.$defs,
  $ref: '#/$defs/locateResult',
});
const groundingReplayValid = groundingResultValidator(groundingReplayResult);

const tasteInputValidator = ajv.compile(tasteInputSchema);
const tasteInputValid = tasteInputValidator(tasteEvaluation.cases[0].input);
const tasteOutputSchemaValid = typeof ajv.compile(tasteOutputSchema) === 'function';

const songInputValidator = ajv.compile(songInputSchema);
const songInputValid = typeof songInputValidator === 'function';
const songArtifactValidator = (definition) =>
  ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: songOutputSchema.$defs,
    $ref: `#/$defs/${definition}`,
  });
const songAnalysisValidator = songArtifactValidator('analysis');
const songPlanValidator = songArtifactValidator('plan');
const songFreezeValidator = songArtifactValidator('freeze');
const songReadLogValidator = songArtifactValidator('generationReadLog');
const songAnalysisValid = songAnalysisValidator(songAnalysis);
const songPlanValid = songPlanValidator(songPlan);
const songFreezeValid = songFreezeValidator(songFreeze);
const songReadLogValid = songReadLogValidator(songReadLog);
const attentionInputValidator = ajv.compile(attentionInputSchema);
const attentionInputValid = attentionInputValidator(attentionEvaluation.cases[0].input);
const attentionOutputSchemaValid = typeof ajv.compile(attentionOutputSchema) === 'function';
const coachInputSchemaValid = typeof ajv.compile(coachInputSchema) === 'function';
const coachOutputSchemaValid = typeof ajv.compile(coachOutputSchema) === 'function';
const coachCalibrationManifestSchemaValid =
  typeof ajv.compile(coachCalibrationManifestSchema) === 'function';
const coachCalibrationReportSchemaValid =
  typeof ajv.compile(coachCalibrationReportSchema) === 'function';

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

const groundingChecks = [
  ['grounding eval input matches LocateRequest schema', groundingInputValid],
  ['grounding replay result matches LocateResult schema', groundingReplayValid],
  [
    'grounding implementation reports its honest validation tier',
    groundingManifest.implementationStatus === 'adapter-implementations-unit-validated' &&
      groundingManifest.validation.status === 'passed' &&
      groundingEvaluation.proof.executed === false,
  ],
  [
    'grounding result retains no provider confidence or media locator',
    groundingReplayResult.observations.every((item) => item.confidence === undefined) &&
      !JSON.stringify(groundingReplayResult).match(/(?:url|path|bytes|base64)/iu),
  ],
];

const tasteChecks = [
  ['creator taste eval input matches its schema', tasteInputValid],
  ['creator taste output schema compiles', tasteOutputSchemaValid],
  [
    'creator taste pack keeps NodeVideo as final write authority',
    tasteManifest.implementationStatus === 'local-cli-and-nodeagent-contract-validated' &&
      tasteManifest.execution.applicationWriteAuthority === 'validation-cas-and-owner-review' &&
      tasteManifest.execution.hiddenEvaluationTarget === 'forbidden-until-freeze',
  ],
  [
    'creator taste eval blocks inconsistent interpretations',
    tasteEvaluation.cases[0].assertions.some((assertion) =>
      assertion.includes('block creative evaluation'),
    ),
  ],
];

const songChecks = [
  ['song-conditioned input schema compiles (aggregate replay envelope excluded)', songInputValid],
  ['song choreography analysis matches the canonical artifact schema', songAnalysisValid],
  ['song selection plan matches the canonical artifact schema', songPlanValid],
  ['song choreography freeze matches the canonical artifact schema', songFreezeValid],
  ['song generation read log matches the canonical artifact schema', songReadLogValid],
  [
    'song pack is bound to the deterministic replay',
    songManifest.implementationStatus === 'deterministic-replay-validated' &&
      songManifest.validation.status === 'passed' &&
      songEvaluation.proof.executed === true,
  ],
  [
    'song replay proof hashes match checked-in artifacts',
    songFreezeReceipt.files.length > 0 &&
      (
        await Promise.all(
          songFreezeReceipt.files.map(
            async (artifact) =>
              (await digest(`fixtures/media/song-conditioned-auto-edit-v1/${artifact.file}`)) ===
              artifact.sha256,
          ),
        )
      ).every(Boolean),
  ],
  [
    'song replay freezes source-only inputs before evaluation',
    songFreeze.isolation.generatorTargetAccess === 'denied' &&
      songFreeze.isolation.finalTargetMount === 'absent' &&
      songReadLog.targetAccess === 'denied' &&
      songReplayManifest.protocol.targetMountedDuringGeneration === false &&
      songReplayManifest.protocol.targetReadDuringGeneration === false,
  ],
  [
    'song replay renders selected music and structurally mutes camera audio',
    songReplayManifest.audio.previewContainsChosenSong === true &&
      songReplayManifest.audio.sourceAudioMuted === true,
  ],
  [
    'song replay evaluator passes mechanics without claiming taste',
    songReplayEvaluation.passed === true &&
      songReplayEvaluation.tasteStatus === 'not-evaluated' &&
      songReplayManifest.evaluation.tasteStatus === 'not-evaluated',
  ],
];

const attentionChecks = [
  ['attention overlay eval input matches its schema', attentionInputValid],
  ['attention overlay output schema compiles', attentionOutputSchemaValid],
  [
    'attention overlay pack keeps grade separate and resolves color automatically',
    attentionManifest.implementationStatus === 'private-real-media-and-contract-validated' &&
      attentionManifest.validation.status === 'passed' &&
      attentionManifest.execution.defaultGrade === 'auto' &&
      attentionManifest.execution.defaultCanvasMode === 'source' &&
      attentionManifest.execution.defaultNumPoses === 6 &&
      attentionManifest.execution.colorPolicy ===
        'preserve-sdr-and-convert-hlg-independent-from-overlay-planning',
  ],
  [
    'attention overlay contract is fail-closed on body clearance',
    attentionEvaluation.cases[0].assertions.includes(
      'rendered glyph body clearance passes conjunctively',
    ) && attentionInputSchema.properties.maxBodyOverlapRatio.maximum === 0.05,
  ],
];

const coachChecks = [
  ['choreography coach input schema compiles', coachInputSchemaValid],
  ['choreography coach output schema compiles', coachOutputSchemaValid],
  ['choreography calibration manifest schema compiles', coachCalibrationManifestSchemaValid],
  ['choreography calibration report schema compiles', coachCalibrationReportSchemaValid],
  [
    'choreography coach pack keeps the human-video claim boundary explicit',
    coachManifest.implementationStatus === 'private-human-experimental' &&
      coachManifest.execution.validatedBoundaries.includes('private-local-calibration') &&
      coachManifest.validation.excludes.includes('artistry') &&
      coachManifest.validation.excludes.includes('generalized-expert-validation'),
  ],
];

const checks = [
  ...tutorialChecks,
  ...authorizedChecks,
  ...groundingChecks,
  ...tasteChecks,
  ...songChecks,
  ...attentionChecks,
  ...coachChecks,
];

for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
if (checks.some(([, passed]) => !passed)) {
  if (!tutorialOutputValid) console.error(tutorialOutputValidator.errors);
  if (!authorizedInputValid) console.error(authorizedInputValidator.errors);
  if (!authorizedOutputValid) console.error(authorizedOutputValidator.errors);
  if (!groundingInputValid) console.error(groundingInputValidator.errors);
  if (!groundingReplayValid) console.error(groundingResultValidator.errors);
  if (!tasteInputValid) console.error(tasteInputValidator.errors);
  if (!songInputValid) console.error(songInputValidator.errors);
  if (!songAnalysisValid) console.error(songAnalysisValidator.errors);
  if (!songPlanValid) console.error(songPlanValidator.errors);
  if (!songFreezeValid) console.error(songFreezeValidator.errors);
  if (!songReadLogValid) console.error(songReadLogValidator.errors);
  if (!attentionInputValid) console.error(attentionInputValidator.errors);
  process.exitCode = 1;
}
