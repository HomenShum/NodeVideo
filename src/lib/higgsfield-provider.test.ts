import { describe, expect, it } from 'vitest';
import {
  HiggsfieldCliClient,
  generationArgs,
  higgsfieldExecutorDefinitions,
} from './higgsfield-provider';

describe('Higgsfield provider', () => {
  it('compiles typed generation parameters without shell fragments', () => {
    expect(
      generationArgs({
        jobType: 'seedance_2_0',
        prompt: 'restrained product film',
        parameters: { duration: 8, 'aspect-ratio': '9:16' },
        references: { images: ['fixture.png'] },
      }),
    ).toEqual([
      'seedance_2_0',
      '--prompt',
      'restrained product film',
      '--aspect-ratio',
      '9:16',
      '--duration',
      '8',
      '--image-references',
      'fixture.png',
    ]);
    expect(() =>
      generationArgs({ jobType: 'safe', prompt: 'x', parameters: { 'x; rm': 'no' } }),
    ).toThrow(/Unsafe/u);
  });

  it('uses JSON mode and parses a replayed CLI response', async () => {
    const calls: string[][] = [];
    const client = new HiggsfieldCliClient(async (_command, args) => {
      calls.push(args);
      return { stdout: '{"credits":42}', stderr: '', exitCode: 0 };
    }, 'higgsfield');
    await expect(client.accountStatus()).resolves.toEqual({ credits: 42 });
    expect(calls[0]).toContain('--json');
  });

  it('does not mark promotional CLI pricing free without evidence', () => {
    expect(
      higgsfieldExecutorDefinitions({ enabled: true, promotionAppliesToCli: false })[0].cost
        .estimatedUsd,
    ).toBeGreaterThan(0);
  });
});
