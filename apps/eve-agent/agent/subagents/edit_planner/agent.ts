import { defineAgent } from 'eve';

export default defineAgent({
  description:
    'Plan source selection, beat-matched cuts, body-safe lyric placement, and a freeze-ready NodeVideo proposal from source-only analysis.',
  model: 'openai/gpt-5.4-mini',
});
