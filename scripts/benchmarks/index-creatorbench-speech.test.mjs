import { describe, expect, it } from 'vitest';
import { parseSrt } from './creatorbench-srt.mjs';

describe('CreatorBench official transcript indexing', () => {
  it('parses multiline SRT captions with millisecond timing', () => {
    expect(
      parseSrt('1\n00:00:05,000 --> 00:00:07,500\nWe built the proof\nbefore the pitch.\n\n'),
    ).toEqual([
      {
        startMs: 5_000,
        endMs: 7_500,
        text: 'We built the proof before the pitch.',
      },
    ]);
  });
});
