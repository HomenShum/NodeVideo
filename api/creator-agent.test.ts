import { describe, expect, test } from 'vitest';
import { parseBody, parsePlannerOutput } from './creator-agent';

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
});
