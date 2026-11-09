/* MAL-047 / MAL-050 form logic: formatting, validation, calculation and visibility.
 *
 * Logic is written into the PDF as standard Acrobat form scripts (AFNumber_Format, AFDate_FormatEx,
 * AFSimple_Calculate, AFRange_Validate, display toggles), so other readers apply it too. MALENJO never
 * runs document JavaScript: this module recognises only those exact statements and evaluates them
 * itself. Anything else is kept in the file but reported as unsupported.
 */
import { compileSafeRegex } from './safeRegex';

/** Acrobat separator styles: 0 = 1,234.56 · 1 = 1234.56 · 2 = 1.234,56 · 3 = 1234,56. */
export type NumberSeparator = 0 | 1 | 2 | 3;
export type FieldFormat =
  | { kind: 'number'; decimals: number; separator: NumberSeparator; currency: string }
  | { kind: 'date'; pattern: string };
export type CalcOp = 'SUM' | 'PRD' | 'AVG' | 'MIN' | 'MAX';
export interface FieldLogic {
  format?: FieldFormat;
  calculate?: { op: CalcOp; fields: string[] };
  range?: { min?: number; max?: number };
  pattern?: { regex: string; message: string };
  /** Shown only while another field has this value ('*' = any value). */
  showWhen?: { field: string; value: string };
  /** Scripts MALENJO does not evaluate; kept in the file, never run. */
  unsupported: string[];
}
/** Field scripts by trigger: K keystroke, F format, V validate, C calculate. */
export type FieldScripts = Partial<Record<'K' | 'F' | 'V' | 'C', string>>;

export const CALC_OPS: [CalcOp, string][] = [['SUM', 'Sum'], ['PRD', 'Product'], ['AVG', 'Average'], ['MIN', 'Minimum'], ['MAX', 'Maximum']];
export const DATE_PATTERNS = ['yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy', 'd mmm yyyy', 'mmmm d, yyyy'];
const lit = (value: string) => JSON.stringify(value);

function checkFormat(format: FieldFormat): void {
  if (format.kind === 'number') {
    if (!Number.isInteger(format.decimals) || format.decimals < 0 || format.decimals > 6) throw new Error('Decimals must be a whole number from 0 to 6.');
    if (![0, 1, 2, 3].includes(format.separator)) throw new Error('Choose a number separator style.');
    if (format.currency.length > 4 || /["\\\n]/.test(format.currency)) throw new Error('The currency symbol must be at most 4 characters.');
  } else if (!/^(?:[dmy]+|[^A-Za-z"\\]){1,40}$/.test(format.pattern) || !/y/.test(format.pattern)) {
    throw new Error('Date formats use d, m and y (for example yyyy-mm-dd).');
  }
}

/** Builds the field's scripts from its logic (unsupported scripts are not rewritten). */
export function logicScripts(logic: Omit<FieldLogic, 'unsupported'>): FieldScripts {
  const scripts: FieldScripts = {};
  if (logic.format) {
    checkFormat(logic.format);
    if (logic.format.kind === 'number') {
      const args = `${logic.format.decimals}, ${logic.format.separator}, 0, 0, ${lit(logic.format.currency)}, true`;
      scripts.K = `AFNumber_Keystroke(${args});`; scripts.F = `AFNumber_Format(${args});`;
    } else {
      scripts.K = `AFDate_KeystrokeEx(${lit(logic.format.pattern)});`; scripts.F = `AFDate_FormatEx(${lit(logic.format.pattern)});`;
    }
  }
  const validate: string[] = [];
  if (logic.range && (logic.range.min !== undefined || logic.range.max !== undefined)) {
    const { min, max } = logic.range;
    if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max)) || (min !== undefined && max !== undefined && min > max)) throw new Error('The range needs a minimum no larger than its maximum.');
    validate.push(`AFRange_Validate(${min !== undefined}, ${min ?? 0}, ${max !== undefined}, ${max ?? 0});`);
  }
  if (logic.pattern) {
    try { new RegExp(logic.pattern.regex); } catch { throw new Error('The pattern is not a valid regular expression.'); }
    if (!safePattern(logic.pattern.regex)) throw new Error('This pattern uses features MALENJO cannot check safely (back-references, look-arounds, named groups or word boundaries).');
    if (!logic.pattern.regex || logic.pattern.regex.length > 200) throw new Error('Enter a pattern of up to 200 characters.');
    const message = logic.pattern.message.trim() || 'The value does not match the required pattern.';
    validate.push(`if (event.value !== "" && !new RegExp(${lit(logic.pattern.regex)}).test(event.value)) { app.alert(${lit(message)}); event.rc = false; }`);
  }
  if (validate.length) scripts.V = validate.join('\n');
  const calculate: string[] = [];
  if (logic.calculate) {
    if (!CALC_OPS.some(([op]) => op === logic.calculate!.op) || !logic.calculate.fields.length) throw new Error('Choose the fields to calculate from.');
    calculate.push(`AFSimple_Calculate(${lit(logic.calculate.op)}, new Array(${logic.calculate.fields.map(lit).join(', ')}));`);
  }
  if (logic.showWhen) {
    const { field, value } = logic.showWhen;
    const test = value === '*' ? `this.getField(${lit(field)}).value !== "" && this.getField(${lit(field)}).value !== "Off"` : `this.getField(${lit(field)}).value == ${lit(value)}`;
    calculate.push(`event.target.display = (${test}) ? display.visible : display.hidden;`);
  }
  if (calculate.length) scripts.C = calculate.join('\n');
  return scripts;
}

const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const NUM = String.raw`-?\d+(?:\.\d+)?`;
const str = (token: string) => JSON.parse(token) as string;
const RULES: [RegExp, (m: RegExpMatchArray, logic: FieldLogic) => void][] = [
  [new RegExp(String.raw`^AFNumber_(?:Keystroke|Format)\(\s*(\d)\s*,\s*([0-3])\s*,\s*\d\s*,\s*\d\s*,\s*(${STRING})\s*,\s*true\s*\);?$`),
    (m, l) => { l.format = { kind: 'number', decimals: Number(m[1]), separator: Number(m[2]) as NumberSeparator, currency: str(m[3]) }; }],
  [new RegExp(String.raw`^AFDate_(?:Keystroke|Format)Ex\(\s*(${STRING})\s*\);?$`), (m, l) => { l.format = { kind: 'date', pattern: str(m[1]) }; }],
  [new RegExp(String.raw`^AFRange_Validate\(\s*(true|false)\s*,\s*(${NUM})\s*,\s*(true|false)\s*,\s*(${NUM})\s*\);?$`),
    (m, l) => { l.range = { ...(m[1] === 'true' ? { min: Number(m[2]) } : {}), ...(m[3] === 'true' ? { max: Number(m[4]) } : {}) }; }],
  [new RegExp(String.raw`^if \(event\.value !== "" && !new RegExp\((${STRING})\)\.test\(event\.value\)\) \{ app\.alert\((${STRING})\); event\.rc = false; \}$`),
    (m, l) => { l.pattern = { regex: str(m[1]), message: str(m[2]) }; }],
  [new RegExp(String.raw`^AFSimple_Calculate\(\s*"(SUM|PRD|AVG|MIN|MAX)"\s*,\s*new Array\(\s*((?:${STRING}\s*,?\s*)+)\)\s*\);?$`),
    (m, l) => { l.calculate = { op: m[1] as CalcOp, fields: (m[2].match(new RegExp(STRING, 'g')) ?? []).map(str) }; }],
  [new RegExp(String.raw`^event\.target\.display = \(this\.getField\((${STRING})\)\.value == (${STRING})\) \? display\.visible : display\.hidden;$`),
    (m, l) => { l.showWhen = { field: str(m[1]), value: str(m[2]) }; }],
  [new RegExp(String.raw`^event\.target\.display = \(this\.getField\((${STRING})\)\.value !== "" && this\.getField\(\1\)\.value !== "Off"\) \? display\.visible : display\.hidden;$`),
    (m, l) => { l.showWhen = { field: str(m[1]), value: '*' }; }],
];

/**
 * Whether a validation pattern can be run. Patterns come from documents and are matched by MALENJO's own
 * linear-time matcher (safeRegex.ts), never by the browser's backtracking engine; this is true when the
 * pattern stays within the subset that matcher supports.
 */
export function safePattern(regex: string): boolean {
  return compileSafeRegex(regex) !== null;
}

/** Reads the supported statements back from a field's scripts; anything else is listed as unsupported. */
export function parseLogic(scripts: FieldScripts): FieldLogic {
  const logic: FieldLogic = { unsupported: [] };
  for (const [trigger, script] of Object.entries(scripts) as [keyof FieldScripts, string][]) {
    if (!script?.trim()) continue;
    // Rules are read only when every statement of the script is one MALENJO recognises. Anything else
    // (conditions, functions, comments) keeps the whole script as unsupported, so nothing nested inside
    // control flow is ever promoted to an unconditional rule.
    const statements = script.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const matched = statements.map((statement) => RULES.find(([pattern]) => pattern.test(statement)));
    const read: FieldLogic = { unsupported: [] };
    if (matched.every(Boolean)) statements.forEach((statement, i) => matched[i]![1](statement.match(matched[i]![0])!, read));
    // A pattern MALENJO cannot run safely is not evaluated: the script stays as the document wrote it.
    if (!matched.every(Boolean) || (read.pattern && !safePattern(read.pattern.regex))) logic.unsupported.push(`${trigger}: ${script}`);
    else Object.assign(logic, { ...read, unsupported: logic.unsupported });
  }
  return logic;
}

/** Names of the fields a field's logic reads. */
export function logicDependencies(logic: FieldLogic): string[] {
  return [...(logic.calculate?.fields ?? []), ...(logic.showWhen ? [logic.showWhen.field] : [])];
}

/** Renames references to a field inside other fields' logic. */
export function renameInLogic(logic: FieldLogic, from: string, to: string): FieldLogic {
  return {
    ...logic,
    ...(logic.calculate ? { calculate: { ...logic.calculate, fields: logic.calculate.fields.map((f) => (f === from ? to : f)) } } : {}),
    ...(logic.showWhen ? { showWhen: { ...logic.showWhen, field: logic.showWhen.field === from ? to : logic.showWhen.field } } : {}),
  };
}

// ---- Values -----------------------------------------------------------------------------------

const SEPARATORS: Record<NumberSeparator, [string, string]> = { 0: [',', '.'], 1: ['', '.'], 2: ['.', ','], 3: ['', ','] };

/** Parses a typed number in the field's separator style; null when it is not a number. */
export function parseNumber(text: string, format?: Extract<FieldFormat, { kind: 'number' }>): number | null {
  let value = text.trim();
  if (!value) return null;
  const [group, decimal] = SEPARATORS[format?.separator ?? 1];
  if (format?.currency) value = value.split(format.currency).join('').trim();
  if (group) value = value.split(group).join('');
  if (decimal !== '.') value = value.replace(decimal, '.');
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : null;
}

export function formatNumber(value: number, format: Extract<FieldFormat, { kind: 'number' }>): string {
  const [group, decimal] = SEPARATORS[format.separator];
  const fixed = Math.abs(value).toFixed(format.decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole;
  return `${value < 0 ? '-' : ''}${format.currency}${grouped}${fraction ? decimal + fraction : ''}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Parses a date typed in the field's pattern; null when it does not match or is not a real date. */
export function parseDate(text: string, pattern: string): Date | null {
  const parts: string[] = [];
  const source = pattern.replace(/(y+|m+|d+)|([^dmy])/g, (_, token: string | undefined, other: string | undefined) => {
    if (other !== undefined) return other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    parts.push(token!);
    if (token === 'mmmm') return '([A-Za-z]+)';
    if (token === 'mmm') return '([A-Za-z]{3})';
    if (token!.startsWith('y')) return token!.length >= 4 ? '(\\d{4})' : '(\\d{2})';
    return token!.length === 2 ? '(\\d{2})' : '(\\d{1,2})';
  });
  const match = new RegExp(`^${source}$`, 'i').exec(text.trim());
  if (!match) return null;
  let year = 0, month = 0, day = 1;
  parts.forEach((token, index) => {
    const value = match[index + 1];
    if (token.startsWith('y')) year = token.length >= 4 ? Number(value) : 2000 + Number(value);
    else if (token.startsWith('d')) day = Number(value);
    else if (token.length >= 3) month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(value.toLowerCase()) && (token.length === 3 ? value.length === 3 : name.toLowerCase() === value.toLowerCase())) + 1;
    else month = Number(value);
  });
  const date = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function formatDate(date: Date, pattern: string): string {
  return pattern.replace(/y+|m+|d+/g, (token) => {
    if (token.startsWith('y')) return token.length >= 4 ? String(date.getUTCFullYear()) : String(date.getUTCFullYear() % 100).padStart(2, '0');
    if (token.startsWith('d')) return token.length === 2 ? String(date.getUTCDate()).padStart(2, '0') : String(date.getUTCDate());
    if (token.length >= 4) return MONTHS[date.getUTCMonth()];
    if (token.length === 3) return MONTHS[date.getUTCMonth()].slice(0, 3);
    return token.length === 2 ? String(date.getUTCMonth() + 1).padStart(2, '0') : String(date.getUTCMonth() + 1);
  });
}

/** The value as shown: formatted for number and date fields, unchanged otherwise. */
export function displayValue(value: string, logic: FieldLogic): string {
  if (!value || !logic.format) return value;
  if (logic.format.kind === 'number') { const n = parseNumber(value, logic.format) ?? parseNumber(value); return n === null ? value : formatNumber(n, logic.format); }
  const date = parseDate(value, logic.format.pattern);
  return date ? formatDate(date, logic.format.pattern) : value;
}

// ---- Evaluation -------------------------------------------------------------------------------

export interface LogicField {
  name: string;
  /** Text value; for a check box its on-value or "Off"; choices joined by newlines. */
  value: string;
  logic: FieldLogic;
  required: boolean;
  maxLength?: number;
  /** Field type; only check boxes and radio buttons use "Off" to mean nothing is chosen. */
  kind?: string;
}
const isButton = (field: LogicField | undefined) => field?.kind === 'checkbox' || field?.kind === 'radio';
export interface FormEvaluation { values: Record<string, string>; hidden: string[]; errors: Record<string, string> }

/** Runs calculations (in dependency order), visibility and validation the way a form reader would. */
export function evaluateForm(fields: LogicField[]): FormEvaluation {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const values: Record<string, string> = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  const numeric = (name: string) => { const f = byName.get(name); const v = values[name] ?? ''; return parseNumber(v, f?.logic.format?.kind === 'number' ? f.logic.format : undefined) ?? parseNumber(v) ?? 0; };
  for (const field of calculationOrder(fields)) {
    const calc = field.logic.calculate!;
    const inputs = calc.fields.map(numeric);
    const result = calc.op === 'SUM' ? inputs.reduce((a, b) => a + b, 0) : calc.op === 'PRD' ? inputs.reduce((a, b) => a * b, 1)
      : calc.op === 'AVG' ? inputs.reduce((a, b) => a + b, 0) / Math.max(1, inputs.length) : calc.op === 'MIN' ? Math.min(...inputs) : Math.max(...inputs);
    const format = field.logic.format?.kind === 'number' ? field.logic.format : undefined;
    const rounded = Number(result.toFixed(format ? format.decimals : 10));
    // Stored with the field's own decimal separator and no grouping, so the field's locale parses it back
    // to the same amount (a "12.5" in a 1.234,56 field would otherwise read as 125).
    values[field.name] = format ? String(rounded).replace('.', SEPARATORS[format.separator][1]) : String(rounded);
  }
  const hidden = fields.filter((f) => {
    if (!f.logic.showWhen) return false;
    const other = values[f.logic.showWhen.field] ?? '';
    return f.logic.showWhen.value === '*' ? !other || (other === 'Off' && isButton(byName.get(f.logic.showWhen.field))) : other !== f.logic.showWhen.value;
  }).map((f) => f.name);
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (hidden.includes(field.name)) continue;
    const value = (values[field.name] ?? '').trim();
    const error = validate(field, value);
    if (error) errors[field.name] = error;
  }
  return { values, hidden, errors };
}

function validate(field: LogicField, value: string): string | null {
  const { logic } = field;
  if (!value || (value === 'Off' && isButton(field))) return field.required ? `${field.name} is required.` : null;
  if (field.maxLength && value.length > field.maxLength) return `${field.name} allows at most ${field.maxLength} characters.`;
  let number: number | null = null;
  if (logic.format?.kind === 'number') {
    number = parseNumber(value, logic.format) ?? parseNumber(value);
    if (number === null) return `${field.name} must be a number.`;
  } else if (logic.format?.kind === 'date' && !parseDate(value, logic.format.pattern)) {
    return `${field.name} must be a date in the form ${logic.format.pattern}.`;
  }
  if (logic.range) {
    number ??= parseNumber(value);
    const { min, max } = logic.range;
    if (number === null || (min !== undefined && number < min) || (max !== undefined && number > max)) {
      return `${field.name} must be ${min !== undefined && max !== undefined ? `between ${min} and ${max}` : min !== undefined ? `at least ${min}` : `at most ${max}`}.`;
    }
  }
  // Matched in linear time; a pattern outside the supported subset is never run.
  const matcher = logic.pattern ? compileSafeRegex(logic.pattern.regex) : null;
  if (logic.pattern && matcher && !matcher.test(value)) return logic.pattern.message;
  return null;
}

/** Calculated fields ordered so each runs after the fields it reads; cycles are refused. */
export function calculationOrder<T extends { name: string; logic: FieldLogic }>(fields: T[]): T[] {
  const calculated = fields.filter((f) => f.logic.calculate);
  const byName = new Map(calculated.map((f) => [f.name, f]));
  const order: T[] = [], state = new Map<string, 'visiting' | 'done'>();
  const visit = (field: T) => {
    if (state.get(field.name) === 'done') return;
    if (state.get(field.name) === 'visiting') throw new Error(`The calculation for ${field.name} depends on itself.`);
    state.set(field.name, 'visiting');
    for (const name of field.logic.calculate!.fields) { const dep = byName.get(name); if (dep) visit(dep); }
    state.set(field.name, 'done'); order.push(field);
  };
  calculated.forEach(visit);
  return order;
}
