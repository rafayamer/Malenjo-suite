import { describe, expect, it } from 'vitest';
import { designDraftSource } from './PdfFormDesignerPanel';
import type { DesignField } from './forms/formDesign';

const base: DesignField = {
  name: 'Code', kind: 'text', widgets: [], tooltip: '', required: false, readOnly: false, maxLength: 10, comb: false, multiline: false,
  options: [], multiselect: false, lock: null, logic: { unsupported: [] }, signed: false, onValue: null,
};

describe('form designer drafts', () => {
  it('refreshes the property drafts when any setting they copy changes, such as after undo', () => {
    const source = designDraftSource(base);
    for (const change of [{ maxLength: 20 }, { comb: true }, { multiline: true }, { lock: { action: 'all' as const, fields: [] } }, { tooltip: 'Hint' }, { logic: { required: true, unsupported: [] } as never }]) {
      expect(designDraftSource({ ...base, ...change })).not.toBe(source);
    }
    expect(designDraftSource({ ...base, widgets: [{ id: 'w' } as never] })).toBe(source);
    expect(designDraftSource(null)).toBe('');
  });
});
