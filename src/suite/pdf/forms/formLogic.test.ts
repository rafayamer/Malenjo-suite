import { describe, expect, it } from 'vitest';
import { calculationOrder, displayValue, evaluateForm, formatDate, formatNumber, logicScripts, parseDate, parseLogic, parseNumber, renameInLogic, type FieldLogic } from './formLogic';

const logic = (l: Partial<FieldLogic> = {}): FieldLogic => ({ unsupported: [], ...l });

describe('form logic scripts (MAL-047 / MAL-050)', () => {
  it('writes standard Acrobat statements and reads them back', () => {
    const source = { format: { kind: 'number' as const, decimals: 2, separator: 0 as const, currency: '$' }, range: { min: 0, max: 500 },
      pattern: { regex: '^\\d+$', message: 'Digits only' }, calculate: { op: 'SUM' as const, fields: ['a', 'b "c"'] }, showWhen: { field: 'opt', value: 'Yes' } };
    const scripts = logicScripts(source);
    expect(scripts.F).toBe('AFNumber_Format(2, 0, 0, 0, "$", true);');
    expect(scripts.K).toBe('AFNumber_Keystroke(2, 0, 0, 0, "$", true);');
    expect(scripts.V).toContain('AFRange_Validate(true, 0, true, 500);');
    expect(scripts.C).toContain('AFSimple_Calculate("SUM", new Array("a", "b \\"c\\""));');
    expect(parseLogic(scripts)).toEqual({ ...source, unsupported: [] });
    expect(parseLogic(logicScripts({ format: { kind: 'date', pattern: 'dd/mm/yyyy' }, showWhen: { field: 'x', value: '*' } })))
      .toEqual({ format: { kind: 'date', pattern: 'dd/mm/yyyy' }, showWhen: { field: 'x', value: '*' }, unsupported: [] });
  });

  it('lists other scripts as unsupported and never treats them as logic', () => {
    const parsed = parseLogic({ C: 'event.value = app.launchURL("x");', V: 'AFRange_Validate(false, 0, true, 10);' });
    expect(parsed.range).toEqual({ max: 10 });
    expect(parsed.unsupported).toEqual(['C: event.value = app.launchURL("x");']);
  });

  it('refuses bad formats, ranges and patterns', () => {
    expect(() => logicScripts({ format: { kind: 'number', decimals: 9, separator: 0, currency: '' } })).toThrow(/Decimals/);
    expect(() => logicScripts({ range: { min: 5, max: 1 } })).toThrow(/minimum/);
    expect(() => logicScripts({ pattern: { regex: '(', message: '' } })).toThrow(/regular expression/);
    expect(() => logicScripts({ format: { kind: 'date', pattern: 'dd/mm' } })).toThrow(/Date formats/);
  });
});

describe('form values', () => {
  it('parses and formats numbers in each separator style', () => {
    expect(formatNumber(1234.5, { kind: 'number', decimals: 2, separator: 0, currency: '$' })).toBe('$1,234.50');
    expect(formatNumber(-1234.5, { kind: 'number', decimals: 1, separator: 2, currency: '' })).toBe('-1.234,5');
    expect(parseNumber('1.234,50', { kind: 'number', decimals: 2, separator: 2, currency: '' })).toBe(1234.5);
    expect(parseNumber('$1,000', { kind: 'number', decimals: 0, separator: 0, currency: '$' })).toBe(1000);
    expect(parseNumber('12a')).toBeNull();
  });

  it('parses and formats dates, rejecting impossible ones', () => {
    expect(parseDate('31/12/2026', 'dd/mm/yyyy')?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(parseDate('31/02/2026', 'dd/mm/yyyy')).toBeNull();
    expect(parseDate('3 Nov 2026', 'd mmm yyyy')?.getUTCMonth()).toBe(10);
    expect(formatDate(new Date(Date.UTC(2026, 10, 3)), 'mmmm d, yyyy')).toBe('November 3, 2026');
    expect(displayValue('2026-11-03', logic({ format: { kind: 'date', pattern: 'yyyy-mm-dd' } }))).toBe('2026-11-03');
  });
});

describe('form evaluation', () => {
  const money = { kind: 'number' as const, decimals: 2, separator: 0 as const, currency: '' };
  it('calculates in dependency order, applies visibility and validates', () => {
    const result = evaluateForm([
      { name: 'total', value: '', required: false, logic: logic({ format: money, calculate: { op: 'SUM', fields: ['sub', 'tax'] } }) },
      { name: 'tax', value: '', required: false, logic: logic({ format: money, calculate: { op: 'PRD', fields: ['sub', 'rate'] } }) },
      { name: 'sub', value: '1,000.00', required: true, logic: logic({ format: money }) },
      { name: 'rate', value: '0.2', required: false, logic: logic({ range: { min: 0, max: 1 } }) },
      { name: 'company', value: 'Off', required: false, logic: logic() },
      { name: 'vat', value: '', required: true, logic: logic({ showWhen: { field: 'company', value: 'Yes' } }) },
      { name: 'code', value: 'ab', required: false, logic: logic({ pattern: { regex: '^[A-Z]{2}$', message: 'Use two capitals.' } }) },
      { name: 'when', value: '2026-13-01', required: false, logic: logic({ format: { kind: 'date', pattern: 'yyyy-mm-dd' } }) },
    ]);
    expect(result.values.tax).toBe('200');
    expect(result.values.total).toBe('1200');
    expect(result.hidden).toEqual(['vat']);
    expect(result.errors).toEqual({ code: 'Use two capitals.', when: 'when must be a date in the form yyyy-mm-dd.' });
  });

  it('reports range, number and required errors, and refuses calculation cycles', () => {
    const result = evaluateForm([
      { name: 'age', value: '130', required: false, logic: logic({ range: { min: 0, max: 120 } }) },
      { name: 'qty', value: 'x', required: false, logic: logic({ format: money }) },
      { name: 'name', value: ' ', required: true, logic: logic() },
    ]);
    expect(result.errors).toEqual({ age: 'age must be between 0 and 120.', qty: 'qty must be a number.', name: 'name is required.' });
    expect(() => calculationOrder([{ name: 'a', logic: logic({ calculate: { op: 'SUM', fields: ['b'] } }) }, { name: 'b', logic: logic({ calculate: { op: 'SUM', fields: ['a'] } }) }])).toThrow(/depends on itself/);
    expect(renameInLogic(logic({ calculate: { op: 'SUM', fields: ['a', 'b'] }, showWhen: { field: 'a', value: '*' } }), 'a', 'z'))
      .toEqual(logic({ calculate: { op: 'SUM', fields: ['z', 'b'] }, showWhen: { field: 'z', value: '*' } }));
  });

  it('keeps calculated amounts right in a 1.234,56 field, and keeps long unsupported scripts whole', () => {
    const euro = { kind: 'number' as const, decimals: 2, separator: 2 as const, currency: '' };
    const result = evaluateForm([
      { name: 'price', value: '12,50', required: false, logic: logic({ format: euro }) },
      { name: 'sub', value: '', required: false, logic: logic({ format: euro, calculate: { op: 'SUM', fields: ['price'] } }) },
      { name: 'total', value: '', required: false, logic: logic({ format: euro, calculate: { op: 'SUM', fields: ['sub'] } }) },
    ]);
    expect(result.values.sub).toBe('12,5');
    expect(displayValue(result.values.sub, logic({ format: euro }))).toBe('12,50');
    expect(result.values.total).toBe('12,5');
    expect(result.errors).toEqual({});
    const long = `app.alert("${'x'.repeat(300)}");`;
    expect(parseLogic({ V: long }).unsupported).toEqual([`V: ${long}`]);
  });

  it('treats "Off" as empty only for check boxes and radio buttons', () => {
    const result = evaluateForm([
      { name: 'Status', kind: 'text', value: 'Off', required: true, logic: logic() },
      { name: 'Qty', kind: 'text', value: 'Off', required: false, logic: logic({ format: { kind: 'number', decimals: 0, separator: 1, currency: '' } }) },
      { name: 'Agree', kind: 'checkbox', value: 'Off', required: true, logic: logic() },
    ]);
    expect(result.errors).toEqual({ Qty: 'Qty must be a number.', Agree: 'Agree is required.' });
  });
});
