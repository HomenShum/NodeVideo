import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentRoot = join(root, 'agent');
const dangerous = ['bash', 'read_file', 'write_file', 'glob', 'grep', 'web_fetch', 'web_search'];
const agentScopes = [
  agentRoot,
  ...['choreography_interpreter', 'edit_planner', 'proof_critic'].map((name) =>
    join(agentRoot, 'subagents', name),
  ),
];

for (const scope of agentScopes) {
  for (const name of dangerous) {
    const source = await readFile(join(scope, 'tools', `${name}.ts`), 'utf8');
    assert.match(source, /disableTool\(\)/, `${name} must be disabled under ${scope}`);
  }
}

const rootAgentOverride = await readFile(join(agentRoot, 'tools', 'agent.ts'), 'utf8');
assert.match(
  rootAgentOverride,
  /Broad root-agent copies are disabled/,
  'the broad root-copy agent tool must be replaced by a rejecting override',
);
assert.doesNotMatch(
  rootAgentOverride,
  /ctx|getSandbox|callControlApi/,
  'the root-copy override must not execute or delegate work',
);

const generationContracts = await readFile(join(agentRoot, 'lib', 'contracts.ts'), 'utf8');
const generationToolNames = [
  'prepare_source_only_job',
  'dispatch_generation',
  'get_generation_status',
];
for (const name of generationToolNames) {
  const source = await readFile(join(agentRoot, 'tools', `${name}.ts`), 'utf8');
  assert.doesNotMatch(
    source,
    /targetAsset|targetSha|evaluation-target/i,
    `${name} must not accept target data`,
  );
}
assert.doesNotMatch(
  generationContracts,
  /targetAsset|targetSha|evaluation-target/i,
  'generation contracts must not admit target data',
);

const rootTools = await readdir(join(agentRoot, 'tools'));
assert(
  !rootTools.includes('evaluate_frozen_edit.ts'),
  'the root must not expose held-out evaluation',
);
for (const name of ['choreography_interpreter', 'edit_planner']) {
  const tools = await readdir(join(agentRoot, 'subagents', name, 'tools'));
  assert(!tools.includes('evaluate_frozen_edit.ts'), `${name} must not expose held-out evaluation`);
}
const evaluator = await readFile(
  join(agentRoot, 'subagents', 'proof_critic', 'tools', 'evaluate_frozen_edit.ts'),
  'utf8',
);
assert.match(
  evaluator,
  /approval:\s*always\(\)/,
  'held-out evaluation must always require approval',
);
assert.match(evaluator, /freezeDigest/, 'held-out evaluation must bind the freeze digest');

const dispatch = await readFile(join(agentRoot, 'tools', 'dispatch_generation.ts'), 'utf8');
assert.match(
  dispatch,
  /approval:\s*always\(\)/,
  'generation dispatch must always require approval',
);
assert.match(dispatch, /proposalDigest/, 'generation dispatch must bind the proposal digest');

console.log('NodeVideo Eve isolation structure verified.');
