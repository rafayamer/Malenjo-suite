import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDF_COMMAND_BY_ID } from '../../src/suite/commands/masterCatalog';
import { VERIFIED_COMMAND_BINDINGS, VERIFIED_EVIDENCE_SCRIPTS } from '../../src/suite/commands/verifiedCommands';

// A MAL capability is RELEASE_READY only through a binding whose evidence is a
// real acceptance check that CI runs. This fails if evidence is renamed,
// removed or invented.
describe('verified command evidence register', () => {
  const scripts = VERIFIED_EVIDENCE_SCRIPTS.map((file) => readFileSync(file, 'utf8')).join('\n');

  it('binds only with evidence that exists in the CI acceptance scripts', () => {
    expect(VERIFIED_COMMAND_BINDINGS.length).toBeGreaterThan(0);
    expect(new Set(VERIFIED_COMMAND_BINDINGS.map((binding) => binding.id)).size).toBe(VERIFIED_COMMAND_BINDINGS.length);
    for (const binding of VERIFIED_COMMAND_BINDINGS) {
      expect(PDF_COMMAND_BY_ID.has(binding.id)).toBe(true);
      expect(binding.guidance.length).toBeGreaterThan(20);
      expect(binding.evidence.length).toBeGreaterThan(0);
      for (const name of binding.evidence) {
        expect(scripts.includes(name), `${binding.id} evidence missing: ${name}`).toBe(true);
      }
    }
  });

  it('every evidence script is a CI browser step', () => {
    const workflow = readFileSync('.github/workflows/pdf-ui-browser.yml', 'utf8');
    for (const file of VERIFIED_EVIDENCE_SCRIPTS) expect(workflow.includes(`node ${file}`), file).toBe(true);
  });
});
