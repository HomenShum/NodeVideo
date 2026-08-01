import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..', '..');
const license = 'NodeVideo generated fixture with provenance';
const licenseUrl = 'https://github.com/HomenShum/NodeVideo/tree/main/fixtures/media';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const definitions = [
  {
    title: 'Generated choreography creator take A',
    repositoryPath: 'fixtures/media/song-conditioned-auto-edit-v1/creator-take-a.mp4',
    expectedSha256: '2676bae057e6642f89f429d04a7bb442d4626a9deab43ee4e14337315192b1e8',
    creatorId: 'creator:nodevideo-generated-choreography',
    relatedSourceGroup: 'repo:song-conditioned-auto-edit-v1',
    domain: 'dance',
    corpusTier: 'multi-take-performance',
    admissibleWorkflows: ['dance-choreography'],
    admissibilityNotes: [
      'Generated choreography take with a retained public provenance manifest.',
      'This fixture demonstrates contract coverage and is not unseen creator footage.',
    ],
  },
  {
    title: 'Generated choreography creator take B',
    repositoryPath: 'fixtures/media/song-conditioned-auto-edit-v1/creator-take-b.mp4',
    expectedSha256: '8ada43b35b9f46f0bbde0661a7602a5b67ae20fae218fa747afc99babe6b0983',
    creatorId: 'creator:nodevideo-generated-choreography',
    relatedSourceGroup: 'repo:song-conditioned-auto-edit-v1',
    domain: 'dance',
    corpusTier: 'multi-take-performance',
    admissibleWorkflows: ['dance-choreography'],
    admissibilityNotes: [
      'Generated choreography take with a retained public provenance manifest.',
      'This fixture demonstrates contract coverage and is not unseen creator footage.',
    ],
  },
  {
    title: 'Generated choreography structural reference',
    repositoryPath:
      'fixtures/media/song-conditioned-auto-edit-v1/original-choreography-reference.mp4',
    expectedSha256: '9cce01af82855387be580c5868f01a5c2ce405f129af04731e80168b48a4ee18',
    creatorId: 'creator:nodevideo-generated-choreography',
    relatedSourceGroup: 'repo:song-conditioned-auto-edit-v1',
    domain: 'dance',
    corpusTier: 'reference-pair',
    admissibleWorkflows: ['dance-choreography', 'reference-template'],
    admissibilityNotes: [
      'Generated structural reference with retained hashes and a public provenance manifest.',
      'It is admissible for structural comparison only and does not establish general taste.',
    ],
  },
  {
    title: 'NodeVideo generated proof reel',
    repositoryPath: 'fixtures/media/nodevideo-proof-v1.mp4',
    expectedSha256: '157b6a8d9257043e4fba50914fa4521058129439ef67acb6b91640982fb20e5a',
    creatorId: 'creator:nodevideo-generated-proof',
    relatedSourceGroup: 'repo:nodevideo-proof-v1',
    domain: 'product-launch',
    corpusTier: 'launch-multi-asset',
    admissibleWorkflows: ['founder-product-launch', 'reference-template'],
    admissibilityNotes: [
      'Synthetic public fixture created from FFmpeg test sources with a retained proof receipt.',
      'It exercises launch-story contracts but is not evidence of real creator usability.',
    ],
  },
];

export async function collectRepositoryFixtureCandidates() {
  return Promise.all(
    definitions.map(async (definition) => {
      const bytes = await readFile(resolve(root, definition.repositoryPath));
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== definition.expectedSha256) {
        throw new Error(
          `${definition.repositoryPath} does not match its retained provenance hash.`,
        );
      }
      const sourceUrl = `repository://nodevideo/${definition.repositoryPath.replaceAll('\\', '/')}`;
      return {
        ...definition,
        sourceUrl,
        sourcePage: `${licenseUrl}/${
          definition.repositoryPath.replace('fixtures/media/', '').split('/')[0]
        }`,
        acquisitionUrl: sourceUrl,
        sourceProvider: 'nodevideo-repository',
        sourceLocatorClass: 'repository-generated-public',
        attribution: 'NodeVideo generated fixture',
        license,
        licenseUrl,
        permittedBenchmarkUses: ['analysis', 'derivatives', 'human-review', 'publication'],
        permittedRedistribution: true,
        clipDurationSeconds: 6,
        startSeconds: 0,
        knownLimitations: [
          'Generated-with-provenance fixture; exclude it from claims about unseen external creators.',
        ],
      };
    }),
  );
}

export const repositoryFixtureDefinitions = definitions;
