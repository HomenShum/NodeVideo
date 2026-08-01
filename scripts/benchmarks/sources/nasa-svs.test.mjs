import { describe, expect, it } from 'vitest';
import { candidateFromNasaSvsPage, selectNasaSvsMovie } from './nasa-svs.mjs';

const page = {
  id: 42,
  url: 'https://svs.gsfc.nasa.gov/42/',
  page_type: 'Visualization',
  title: 'Earth motion',
  description: 'A public scientific visualization.',
  credits: [{ role: 'Visualizer', people: [{ name: 'A. Researcher' }] }],
  media_groups: [
    {
      description: 'Visual material.',
      items: [
        {
          instance: {
            media_type: 'Movie',
            filename: 'large.mp4',
            url: 'https://svs.gsfc.nasa.gov/vis/large.mp4',
            pixels: 2_073_600,
          },
        },
        {
          instance: {
            media_type: 'Movie',
            filename: 'small.webm',
            url: 'https://svs.gsfc.nasa.gov/vis/small.webm',
            pixels: 230_400,
          },
        },
      ],
    },
  ],
};

describe('NASA SVS CreatorBench provider', () => {
  it('selects the smallest reusable movie derivative', () => {
    expect(selectNasaSvsMovie(page)?.filename).toBe('small.webm');
  });

  it('creates an audio-stripped, source-disjoint public-domain candidate', () => {
    const candidate = candidateFromNasaSvsPage(page, {
      id: 'nature-landscape',
      query: 'earth motion',
    });
    expect(candidate).toMatchObject({
      sourceProvider: 'nasa-svs',
      sourceLocatorClass: 'nasa-svs-public-domain',
      license: 'NASA SVS public domain',
      stripAudio: true,
      permittedRedistribution: true,
      relatedSourceGroup: 'nasa-svs:42',
    });
    expect(candidate.creatorId).toMatch(/^creator:[a-f0-9]{16}$/u);
  });

  it('rejects assets carrying an explicit third-party copyright restriction', () => {
    expect(
      candidateFromNasaSvsPage(
        { ...page, description: 'Copyright material by an external producer.' },
        { id: 'science-demonstration', query: 'science' },
      ),
    ).toBeUndefined();
  });
});
