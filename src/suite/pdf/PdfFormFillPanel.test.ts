import { describe, expect, it } from 'vitest';
import { formatHint } from './PdfFormFillPanel';
import type { FillField } from './forms/formFill';

const field: FillField = {
  name: 'Amount', kind: 'text', value: '', onValue: null, options: [], multiselect: false, required: false, readOnly: false, maxLength: null,
  logic: { format: { kind: 'number', decimals: 2, separator: 0, currency: '' }, unsupported: [] }, calculated: false,
  password: false, multiline: false, concealedValue: false, editable: false,
};

describe('fill form hints', () => {
  it('shows a formatted value, but never a password in plain text', () => {
    expect(formatHint(field, '1234', false)).toBe('Shown as 1,234.00');
    expect(formatHint({ ...field, password: true }, '1234', false)).toBeNull();
    expect(formatHint(field, '1234', true)).toBeNull();
  });
});
