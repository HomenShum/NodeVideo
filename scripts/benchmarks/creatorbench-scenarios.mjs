export const creatorBenchScenarios = [
  {
    id: 'baseline',
    description: 'Default governed request for the workflow.',
  },
  {
    id: 'local-private',
    description: 'Requires local-only execution with no media egress.',
  },
  {
    id: 'bounded-assistance',
    description: 'Allows one explicit subject seed while preserving review boundaries.',
  },
  {
    id: 'multi-format',
    description: 'Requests downloadable horizontal, vertical, and square outputs.',
  },
  {
    id: 'latency-bound',
    description: 'Requires a credible route within a thirty-second latency budget.',
  },
  {
    id: 'zero-cost',
    description: 'Requires a zero-dollar route and safe abstention when none is credible.',
  },
  {
    id: 'preservation-strict',
    description: 'Raises semantic, speech, identity, and action-context preservation requirements.',
  },
  {
    id: 'uncertainty-stress',
    description: 'Requires review or abstention instead of success under unresolved uncertainty.',
  },
];

export function applyCreatorBenchScenario(baseRequest, scenario) {
  const request = structuredClone(baseRequest);
  request.id = `${baseRequest.id}:${scenario.id}`;

  switch (scenario.id) {
    case 'baseline':
      return request;
    case 'local-private':
      request.constraints = {
        ...request.constraints,
        privacy: 'private',
        localOnly: true,
        maxCostUsd: 0,
        mediaEgress: 'prohibited',
        prohibitedExecutors: [
          ...new Set([
            ...request.constraints.prohibitedExecutors,
            'runtime:api',
            'runtime:remote-worker',
            'runtime:mcp',
          ]),
        ],
      };
      request.requiredHumanApprovalPoints = request.requiredHumanApprovalPoints.filter(
        (point) => point !== 'before-media-egress',
      );
      request.intent.instruction +=
        ' Keep all media and derived artifacts local; do not route through a hosted executor.';
      return request;
    case 'bounded-assistance':
      request.selectedSubject = { kind: 'point', value: [0.5, 0.5], frameMs: 0 };
      request.intent.instruction +=
        ' Treat the center-frame point as one bounded user seed, verify it, and do not imply automatic discovery.';
      return request;
    case 'multi-format':
      request.output = {
        ...request.output,
        destinations: ['review', 'download'],
        aspectRatios: ['16:9', '9:16', '1:1'],
      };
      request.intent.instruction +=
        ' Return reviewable 16:9, 9:16, and 1:1 variants from the same source lineage.';
      return request;
    case 'latency-bound':
      request.constraints.maxLatencyMs = 30_000;
      request.intent.instruction +=
        ' Complete within thirty seconds or classify the request honestly instead of exceeding the budget.';
      return request;
    case 'zero-cost':
      request.constraints.maxCostUsd = 0;
      request.intent.instruction += ' Use a zero-dollar credible route or safely abstain.';
      return request;
    case 'preservation-strict':
      request.intent.preserve = [
        ...new Set([
          ...request.intent.preserve,
          'all spoken words',
          'identity continuity',
          'important limbs and objects',
          'action context',
        ]),
      ];
      request.intent.instruction +=
        ' Prefer preservation over aggressive editing whenever evidence is ambiguous.';
      return request;
    case 'uncertainty-stress':
      request.intent.avoid = [
        ...new Set([
          ...request.intent.avoid,
          'false confidence',
          'unreviewed low-confidence edits',
        ]),
      ];
      request.intent.instruction +=
        ' When confidence is unresolved, require review or safely abstain rather than imply success.';
      return request;
    default:
      throw new Error(`Unknown CreatorBench scenario: ${scenario.id}.`);
  }
}
