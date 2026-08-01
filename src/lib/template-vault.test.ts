import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TemplateSpec } from './media-orchestration-contracts';
import { validateTemplateSpec } from './media-orchestration-contracts';

const catalog = JSON.parse(
  readFileSync(
    new URL('../../packs/reference-template/templates/catalog.json', import.meta.url),
    'utf8',
  ),
) as { schemaVersion: string; templates: TemplateSpec[] };

describe('reference template vault', () => {
  it('contains only valid non-copying structural templates', () => {
    expect(catalog.schemaVersion).toBe('nodevideo.template-catalog.v1');
    expect(catalog.templates.length).toBeGreaterThanOrEqual(3);
    for (const template of catalog.templates) {
      expect(() => validateTemplateSpec(template)).not.toThrow();
      expect(template.provenance.redistributionAllowed).toBe(false);
      expect(template.brandPolicy.copyBrandAssets).toBe(false);
    }
  });
});
