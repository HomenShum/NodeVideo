import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const destination = resolve(process.argv[2] ?? '.qa/evidence/higgsfield/benchmark-queue.json');
const models = (
  process.env.HIGGSFIELD_BENCHMARK_MODELS ?? 'auto,seedance_2_0,kling_3_0,veo_3_1,wan_2_7'
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const briefs = [
  [
    'human-motion',
    'A synthetic dancer performing one athletic turn in a neutral studio; natural anatomy, stable limbs, locked camera.',
  ],
  [
    'product-ui',
    'A restrained cinematic product-film shot of an abstract software interface in a dark studio; no readable invented text.',
  ],
  [
    'agent-orchestration',
    'Abstract human and AI agents coordinating around shared artifacts, visible review gates and proof receipts.',
  ],
  [
    'education',
    'A precise but metaphorical visualization of a mathematical idea; no equations or factual labels rendered by the model.',
  ],
  [
    'product-ad',
    'Premium fifteen-second product advertisement structure with a clear object, benefit demonstration, and clean end frame.',
  ],
  [
    'synthetic-spokesperson',
    'A fully synthetic adult founder speaking to camera in a consistent neutral studio across multiple shots.',
  ],
  [
    'spatial-world',
    'A 3D-looking Node ecosystem room with artifact planes, a timeline, and proof objects; no third-party marks.',
  ],
  [
    'reference-structure',
    'Transform an authorized structural reference into an original shot with similar pacing but different subjects, branding, and assets.',
  ],
];
const queue = {
  schemaVersion: 'nodevideo.provider-benchmark-queue.v1',
  createdAt: new Date().toISOString(),
  models,
  cases: briefs.flatMap(([id, prompt]) =>
    models.map((model) => ({
      id: `${id}:${model}`,
      briefId: id,
      model,
      prompt,
      status: 'planned',
      repetitions: 3,
      scoreDimensions: [
        'promptAdherence',
        'identityConsistency',
        'temporalConsistency',
        'cameraQuality',
        'humanAnatomy',
        'textFidelity',
        'brandFit',
        'editability',
        'artifactRate',
      ],
      rights: { syntheticPeopleOnly: true, sourceAssetsOwned: true, publicReleaseApproved: false },
    })),
  ),
};
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
console.log(`${queue.cases.length} benchmark cases -> ${destination}`);
