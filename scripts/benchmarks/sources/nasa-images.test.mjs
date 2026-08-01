import { describe, expect, it } from 'vitest';
import { collectNasaImagesCandidates, selectNasaImagesMovie } from './nasa-images.mjs';

describe('NASA Images CreatorBench provider', () => {
  it('selects a bounded MP4 derivative and upgrades transport to HTTPS', () => {
    expect(
      selectNasaImagesMovie([
        'http://images-assets.nasa.gov/video/demo/demo~orig.mp4',
        'http://images-assets.nasa.gov/video/demo/demo~mobile.mp4',
      ]),
    ).toBe('https://images-assets.nasa.gov/video/demo/demo~mobile.mp4');
  });

  it('emits speech-workflow candidates without blanket publication permission', async () => {
    const fetchImpl = async (url) => {
      if (String(url).startsWith('https://images-api.nasa.gov/search')) {
        return new Response(
          JSON.stringify({
            collection: {
              items: [
                {
                  href: 'https://images-assets.nasa.gov/video/demo/collection.json',
                  data: [
                    {
                      nasa_id: 'demo',
                      title: 'Demo interview',
                      media_type: 'video',
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify(['http://images-assets.nasa.gov/video/demo/demo~mobile.mp4']),
        { status: 200 },
      );
    };
    const candidates = await collectNasaImagesCandidates({ target: 1, fetchImpl });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      corpusTier: 'speech-long-form',
      permittedRedistribution: false,
      admissibleWorkflows: [
        'talking-head-cleanup',
        'golden-quote-variants',
        'reference-template',
        'captioned-multi-format',
      ],
    });
    expect(candidates[0].permittedBenchmarkUses).not.toContain('publication');
  });
});
