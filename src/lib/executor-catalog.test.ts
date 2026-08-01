import { describe, expect, it } from 'vitest';
import { buildExecutorCatalog } from './executor-catalog';

describe('executor catalog', () => {
  it('enables proven local tools and keeps unavailable specialist models disabled', () => {
    const catalog = buildExecutorCatalog({
      localMediaWorker: true,
      whisper: true,
      sceneDetect: true,
      opencv: true,
      higgsfieldAuthenticated: false,
      higgsfieldPromotionAppliesToCli: false,
    });
    expect(catalog.find((item) => item.id === 'executor.ffmpeg-edit-plan')?.enabled).toBe(true);
    expect(catalog.find((item) => item.id === 'executor.higgsfield-video')?.enabled).toBe(false);
    expect(catalog.find((item) => item.id === 'executor.trellis')?.enabled).toBe(false);
  });
});
