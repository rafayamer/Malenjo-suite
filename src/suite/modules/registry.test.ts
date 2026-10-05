import { describe, expect, it } from 'vitest';
import { modules } from './registry';

describe('MALENJO module registry', () => {
  it('has unique module ids', () => {
    const ids = modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the mandatory document workspaces', () => {
    const ids = new Set(modules.map((module) => module.id));
    for (const id of ['files', 'pdf', 'word', 'spreadsheet', 'presentation', 'ocr', 'ai', 'security']) {
      expect(ids.has(id as never)).toBe(true);
    }
  });
});
