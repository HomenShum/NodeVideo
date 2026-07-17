import { defineTool } from 'eve/tools';
import { z } from 'zod';

export default defineTool({
  description:
    'Reject broad root-agent copies. Use the declared choreography_interpreter, edit_planner, or proof_critic specialist instead.',
  inputSchema: z.object({
    message: z.string().max(4000),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  }),
  execute() {
    return {
      status: 'rejected',
      reason:
        'Broad root-agent copies are disabled; delegate to a declared least-privilege specialist.',
    };
  },
});
