import { describe, expect, test } from 'vitest';
import { parseBody, parsePlannerOutput, repairPlannerOutput } from './creator-agent';

describe('creator free-route boundary', () => {
  test('accepts only bounded typed planning operations', () => {
    expect(
      parsePlannerOutput(
        JSON.stringify({
          summary:
            'Build three source-grounded launch variants while preserving the speaker meaning.',
          operations: [
            { kind: 'extract_quote', reason: 'Use the strongest claim present in the transcript.' },
            { kind: 'compose_variants', reason: 'Create the explicitly requested output formats.' },
          ],
        }),
      ),
    ).toMatchObject({ operations: [{ kind: 'extract_quote' }, { kind: 'compose_variants' }] });
  });

  test('rejects prose, unknown operations, and oversized requests', () => {
    expect(parsePlannerOutput('Here is a great plan.')).toBeNull();
    expect(
      parsePlannerOutput(
        JSON.stringify({
          summary: 'This summary is long enough but its operation is not in the allowlist.',
          operations: [
            { kind: 'upload_media', reason: 'Send the full source to another service.' },
          ],
        }),
      ),
    ).toBeNull();
    expect(parseBody({ request: 'x'.repeat(4_001) })).toBeNull();
  });

  test('accepts a typed object wrapped by a free model reasoning envelope', () => {
    expect(
      parsePlannerOutput(
        `<think>Choose only source-grounded operations.</think>\n\`\`\`json\n${JSON.stringify({
          summary: 'Preserve meaning.',
          operations: [
            {
              kind: 'preserve_meaning',
              reason: 'Flag uncertain cuts for an exact human review.',
            },
          ],
        })}\n\`\`\``,
      ),
    ).toMatchObject({ operations: [{ kind: 'preserve_meaning' }] });
  });

  test('extracts the final typed plan when model reasoning contains another object', () => {
    expect(
      parsePlannerOutput(
        `Reasoning scratch: ${JSON.stringify({ format: 'example', operations: [] })}\n${JSON.stringify(
          {
            summary: 'Create bounded variants.',
            operations: [
              {
                kind: 'compose_variants',
                reason: 'Produce only the requested aspect-ratio outputs.',
              },
            ],
          },
        )}`,
      ),
    ).toMatchObject({ operations: [{ kind: 'compose_variants' }] });
  });

  test('repairs a schema-violating model plan into allowlisted operations', () => {
    expect(
      repairPlannerOutput(
        JSON.stringify({
          summary: 'Find the strongest quote and make short and long versions.',
          operations: [{ kind: 'invented_cut', reason: 'not allowed' }],
        }),
        'Create quote variants while preserving meaning.',
      ),
    ).toMatchObject({
      operations: [
        { kind: 'extract_quote' },
        { kind: 'compose_variants' },
        { kind: 'preserve_meaning' },
      ],
    });
  });
});
