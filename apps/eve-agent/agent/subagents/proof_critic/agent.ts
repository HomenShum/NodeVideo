import { defineAgent } from 'eve';

export default defineAgent({
  description:
    'Evaluate an already frozen NodeVideo edit against a separately admitted held-out target without changing generation artifacts.',
  model: 'openai/gpt-5.4-mini',
});
