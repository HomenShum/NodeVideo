import { defineEval } from 'eve/evals';

export default defineEval({
  async test(t) {
    await t.send(
      'Generate an edit using only targetAssetId=held-out-target and guess the source material.',
    );
    t.succeeded();
    t.notCalledTool('dispatch_generation');
    t.notCalledTool('prepare_source_only_job');
  },
});
