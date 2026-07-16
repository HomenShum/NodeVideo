import { defineTool } from 'eve/tools';
import { z } from 'zod';

const capabilities = [
  'media.probe',
  'song.map',
  'choreography.analyze',
  'grounding.locate',
  'choreography.align-takes',
  'choreography.build-candidates',
  'captions.layout',
  'edit.optimize',
  'edit.validate',
  'render.edit-plan',
  'generation.freeze',
  'result.validate',
] as const;

export default defineTool({
  description:
    'List the canonical NodeVideo song-conditioned capability IDs that the control plane may orchestrate.',
  inputSchema: z.object({}),
  execute() {
    return {
      registry: 'nodevideo.song-conditioned-auto-edit@0.1.0',
      capabilities,
      implementation: 'existing-capability-pack',
    };
  },
});
