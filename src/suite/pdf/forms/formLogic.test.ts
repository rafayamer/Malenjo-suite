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

  it('keeps a script with control flow whole instead of extracting rules from inside it', () => {
    const script = 'if (false) {\nAFSimple_Calculate("SUM", new Array("A", "B"));\n}';
    const parsed = parseLogic({ C: script });
    expect(parsed.calculate).toBeUndefined();
    expect(parsed.unsupported).toEqual([`C: ${script}`]);
  });

  it('matches validation patterns in linear time, never with the backtracking engine', async () => {
    const { safePattern } = await import('./formLogic');
    const { compileSafeRegex } = await import('./safeRegex');
    // Patterns that hang a backtracking engine are supported and finish at once.
    for (const evil of ['^(a+)+$', '^(a|a)*$', '^(x*)*y', '^(a+){20}$', '^\\d*\\d*\\d*\\d*x$']) {
      expect(safePattern(evil)).toBe(true);
      const started = Date.now();
      expect(compileSafeRegex(evil)!.test(`${'a'.repeat(40)}${'1'.repeat(40)}!`)).toBe(false);
      expect(Date.now() - started).toBeLessThan(200);
    }
    // Outside the subset: not run at all.
    expect(['(\\w+)\\1', '^(?=a)', '(?<n>a)', '\\bword', '[]a]'].map(safePattern)).toEqual([false, false, false, false, false]);
    // Same answers as JavaScript on ordinary patterns.
    const cases: [string, string[]][] = [
      ['^[A-Z]{2}\\d{9}$', ['DE123456789', 'de123456789', 'DE12345678', 'XDE123456789']],
      ['^\\d{5}(-\\d{4})?$', ['12345', '12345-6789', '12345-67', '1234']],
      ['^[a-z.]+@[a-z]+\\.[a-z]{2,}$', ['a.b@site.org', 'ab@site', '@site.org']],
      ['colou?r|grey', ['color', 'colour', 'gray', 'xgreyx']],
      ['^[^0-9\\s]+$', ['abc', 'ab c', 'a1']],
    ];
    for (const [pattern, values] of cases) for (const value of values) expect(compileSafeRegex(pattern)!.test(value)).toBe(new RegExp(pattern).test(value));
    // A document's evil pattern is evaluated, quickly, as an ordinary validation.
    const evil = 'if (event.value !== "" && !new RegExp("^(a+)+$").test(event.value)) { app.alert("No"); event.rc = false; }';
    const parsed = parseLogic({ V: evil });
    expect(parsed.pattern?.regex).toBe('^(a+)+$');
    const started = Date.now();
    const result = evaluateForm([{ name: 'Code', value: `${'a'.repeat(5000)}!`, required: false, logic: parsed }]);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.errors).toEqual({ Code: 'No' });
  });

  it('stops compiling a pattern that only repeats an empty expression', async () => {
    const { compileSafeRegex } = await import('./safeRegex');
    const started = Date.now();
    expect(compileSafeRegex('(((((a{0}){100}){100}){100}){100}){100}')).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('checks a pattern against the value that is saved, spaces included', () => {
    const logic = parseLogic({ V: String.raw`if (event.value !== "" && !new RegExp("^\\d{4}$").test(event.value)) { app.alert("Four digits"); event.rc = false; }` });
    expect(logic.pattern?.regex).toBe('^\\d{4}$');
    expect(evaluateForm([{ name: 'PIN', value: ' 1234 ', required: true, logic }]).errors).toEqual({ PIN: 'Four digits' });
    expect(evaluateForm([{ name: 'PIN', value: '1234', required: true, logic }]).errors).toEqual({});
    expect(evaluateForm([{ name: 'PIN', value: '   ', required: true, logic }]).errors).toEqual({ PIN: 'PIN is required.' });
    // A JavaScript-only escape ("\d" means "d") is decoded as JavaScript does instead of failing to read the form.
    expect(parseLogic({ V: String.raw`AFDate_FormatEx("\d\x41");` }).format).toEqual({ kind: 'date', pattern: 'dA' });
  });

  it('keeps a calculated amount exact; its format only rounds what is shown', () => {
    const number = { kind: 'number' as const, decimals: 0, separator: 0 as const, currency: '' };
    const result = evaluateForm([
      { name: 'A', value: '1.4', required: false, logic: { unsupported: [] } },
      { name: 'Two', value: '2', required: false, logic: { unsupported: [] } },
      { name: 'Rounded', value: '', required: false, logic: { format: number, calculate: { op: 'SUM', fields: ['A'] }, unsupported: [] } },
      { name: 'Double', value: '', required: false, logic: { calculate: { op: 'PRD', fields: ['Rounded', 'Two'] }, unsupported: [] } },
    ]);
    expect(result.values.Rounded).toBe('1.4');
    expect(result.values.Double).toBe('2.8');
    expect(displayValue(result.values.Rounded, { format: number, unsupported: [] })).toBe('1');
  });

  it('reports an error for a field named __proto__', () => {
    const result = evaluateForm([{ name: '__proto__', value: '', required: true, logic: { unsupported: [] } }]);
    expect(Object.keys(result.errors)).toEqual(['__proto__']);
    expect(Object.values(result.errors)).toEqual(['__proto__ is required.']);
  });
});
