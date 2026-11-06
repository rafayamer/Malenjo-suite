/* MAL-053 form data import and export: CSV, JSON, FDF and XFDF.
 *
 * Values use each field's export value (choices, radio buttons) or its on-value / Off (check
 * boxes). Several selections are separate CSV rows, JSON arrays, FDF arrays and XFDF <value>s.
 * Import never runs scripts; it returns values for fillFormWithLogic, plus names it did not match.
 */
import { PDFArray, PDFContext, PDFDict, PDFHexString, PDFName, PDFObjectParser, PDFRef, PDFString } from 'pdf-lib';
import type { FillField } from './formFill';

export type FormDataFormat = 'csv' | 'json' | 'fdf' | 'xfdf';
export const FORM_DATA_FORMATS: [FormDataFormat, string, string][] = [
  ['csv', 'CSV', 'text/csv'], ['json', 'JSON', 'application/json'], ['fdf', 'FDF', 'application/vnd.fdf'], ['xfdf', 'XFDF', 'application/vnd.adobe.xfdf'],
];
const MAX_INPUT = 5 * 1024 * 1024;

const dataFields = (fields: FillField[]) => fields.filter((f) => f.kind !== 'button' && f.kind !== 'signature');
const listOf = (f: FillField, value: string) => (f.kind === 'list' || f.kind === 'dropdown') && f.multiselect ? value.split('\n').filter(Boolean) : [value];

const csvCell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const pdfString = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? `(${v.replace(/[\\()]/g, '\\$&')})` : PDFHexString.fromText(v).toString());
const pdfName = (v: string) => '/' + Array.from(new TextEncoder().encode(v), (b) => (b > 0x20 && b < 0x7f && !'#/()<>[]{}%'.includes(String.fromCharCode(b)) ? String.fromCharCode(b) : `#${b.toString(16).padStart(2, '0')}`)).join('');
const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportFormData(fields: FillField[], format: FormDataFormat, sourceName = 'form.pdf'): string {
  const list = dataFields(fields);
  if (format === 'json') {
    return JSON.stringify(Object.fromEntries(list.map((f) => [f.name, f.multiselect ? listOf(f, f.value) : f.value])), null, 2) + '\n';
  }
  if (format === 'csv') {
    const rows = [['name', 'value'], ...list.flatMap((f) => { const values = listOf(f, f.value); return (values.length ? values : ['']).map((v) => [f.name, v]); })];
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  if (format === 'fdf') {
    const entries = list.map((f) => {
      const value = f.kind === 'checkbox' || f.kind === 'radio' ? (f.value ? pdfName(f.value) : '/Off')
        : f.multiselect ? `[${listOf(f, f.value).map(pdfString).join(' ')}]` : pdfString(f.value);
      return `<< /T ${pdfString(f.name)} /V ${value} >>`;
    });
    return `%FDF-1.2\n%âãÏÓ\n1 0 obj\n<< /FDF << /F ${pdfString(sourceName)} /Fields [\n${entries.join('\n')}\n] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  }
  const items = list.map((f) => `  <field name="${xml(f.name)}">${listOf(f, f.value).map((v) => `<value>${xml(v)}</value>`).join('') || '<value></value>'}</field>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n  <f href="${xml(sourceName)}"/>\n <fields>\n${items.join('\n')}\n </fields>\n</xfdf>\n`;
}

export interface ImportedFormData { values: Record<string, string>; unknown: string[]; skipped: string[] }

/** Parses form data and matches it to this form's fields (by full name). */
export function importFormData(fields: FillField[], text: string, format: FormDataFormat): ImportedFormData {
  if (text.length > MAX_INPUT) throw new Error('Form data files are limited to 5 MB.');
  const raw = format === 'json' ? parseJson(text) : format === 'csv' ? parseCsv(text) : format === 'fdf' ? parseFdf(text) : parseXfdf(text);
  const byName = new Map(dataFields(fields).map((f) => [f.name, f]));
  const values: Record<string, string> = {}, unknown: string[] = [], skipped: string[] = [];
  for (const [name, list] of raw) {
    const field = byName.get(name);
    if (!field) { unknown.push(name); continue; }
    if (field.readOnly || field.calculated) { skipped.push(name); continue; }
    if (field.kind === 'checkbox') {
      const v = list[0] ?? '';
      // The field's own on-value wins over the yes/no shorthands, so a box whose on-value is "No" round-trips.
      values[name] = field.onValue && v === field.onValue ? field.onValue : /^(off|false|no|0|)$/i.test(v) ? 'Off' : field.onValue ?? 'Yes';
    } else if (field.kind === 'text') values[name] = list.join('\n');
    else {
      const allowed = new Set(field.options.map((o) => o.value));
      // A label is accepted in place of its export value.
      // An unanswered radio group is exported as /Off: it means nothing is selected.
      const mapped = list.filter((v) => Boolean(v) && !(field.kind === 'radio' && v === 'Off')).map((v) => (allowed.has(v) ? v : field.options.find((o) => o.label === v)?.value ?? v));
      const bad = mapped.find((v) => !allowed.has(v) && !(field.kind === 'dropdown' && !field.multiselect));
      if (bad !== undefined) throw new Error(`“${bad}” is not an option of ${name}.`);
      if (mapped.length > 1 && !field.multiselect) throw new Error(`${name} takes one value.`);
      values[name] = mapped.join('\n');
    }
  }
  return { values, unknown, skipped };
}

type Raw = Map<string, string[]>;
const add = (map: Raw, name: string, value: string) => map.set(name, [...(map.get(name) ?? []), value]);

function parseJson(text: string): Raw {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('This is not valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Form JSON is an object of field name → value.');
  const map: Raw = new Map();
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => !['string', 'number', 'boolean'].includes(typeof v))) throw new Error(`The value of ${name} must be text, a number, true/false or a list.`);
    map.set(name, values.map((v) => (v === true ? 'Yes' : v === false ? 'Off' : String(v))));
  }
  return map;
}

function parseCsv(text: string): Raw {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"' && !cell) quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter((r) => r.some((c) => c.trim()));
  if (!data.length) throw new Error('The CSV file is empty.');
  const map: Raw = new Map();
  if (data[0][0]?.trim().toLowerCase() === 'name' && data[0][1]?.trim().toLowerCase() === 'value') {
    for (const [name, value = ''] of data.slice(1)) if (name?.trim()) add(map, name.trim(), value);
  } else if (data.length >= 2) {
    // A header row of field names with one row of values (mail-merge style).
    data[0].forEach((name, index) => { if (name.trim()) add(map, name.trim(), data[1][index] ?? ''); });
  } else throw new Error('CSV form data needs a name,value header or a header row of field names and a row of values.');
  return map;
}

function decode(value: unknown): string[] {
  if (value instanceof PDFString || value instanceof PDFHexString) return [value.decodeText()];
  if (value instanceof PDFName) return [value.decodeText()];
  if (value instanceof PDFArray) return value.asArray().flatMap(decode);
  return [];
}
function parseFdf(text: string): Raw {
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  if (!text.startsWith('%FDF-')) throw new Error('This is not an FDF file.');
  // Field dictionaries may be indirect objects (`/Fields [2 0 R]`): read every `n g obj` into one context
  // so references, including those in /Kids, resolve.
  const context = PDFContext.create();
  let root: unknown;
  try {
    let count = 0;
    for (const match of text.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
      if (++count > 20000) throw new Error('too many objects');
      const object = PDFObjectParser.forBytes(bytes.subarray(match.index! + match[0].length), context).parseObject();
      context.assign(PDFRef.of(Number(match[1]), Number(match[2])), object);
      if (!root && object instanceof PDFDict && object.has(PDFName.of('FDF'))) root = object;
    }
    if (!root) {
      const start = text.indexOf('<<');
      if (start < 0) throw new Error('This FDF file has no form data.');
      root = PDFObjectParser.forBytes(bytes.subarray(start), context).parseObject();
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'This FDF file has no form data.') throw error;
    throw new Error('This FDF file could not be read.');
  }
  const resolve = (value: unknown) => (value instanceof PDFRef ? context.lookup(value) : value);
  const fdf = root instanceof PDFDict ? resolve(root.get(PDFName.of('FDF'))) : undefined;
  const list = fdf instanceof PDFDict ? resolve(fdf.get(PDFName.of('Fields'))) : undefined;
  if (!(list instanceof PDFArray)) throw new Error('This FDF file has no form fields.');
  const map: Raw = new Map();
  const seen = new Set<unknown>();
  const walk = (value: unknown, prefix: string) => {
    const entry = resolve(value);
    if (!(entry instanceof PDFDict) || seen.has(entry)) return;
    seen.add(entry);
    const name = decode(entry.get(PDFName.of('T')))[0] ?? '';
    const full = prefix && name ? `${prefix}.${name}` : prefix || name;
    const kids = resolve(entry.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) { kids.asArray().forEach((kid) => walk(kid, full)); return; }
    if (full) map.set(full, decode(resolve(entry.get(PDFName.of('V')))));
  };
  list.asArray().forEach((entry) => walk(entry, ''));
  return map;
}

const unxml = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
function parseXfdf(text: string): Raw {
  if (!/<xfdf[\s>]/.test(text)) throw new Error('This is not an XFDF file.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XFDF files with document type declarations are not accepted.');
  const body = /<fields>([\s\S]*)<\/fields>/.exec(text)?.[1];
  if (body === undefined) throw new Error('This XFDF file has no form fields.');
  const map: Raw = new Map();
  // Nested <field> elements build dotted names; <value> elements belong to the innermost open field.
  const stack: string[] = [];
  // Attributes may use either quote style (name="x" or name='x').
  const tag = /<(\/?)(field|value)(?:\s+name=(?:"([^"]*)"|'([^']*)'))?\s*(\/?)>|<\/value>/g;
  let match: RegExpExecArray | null, valueStart = -1;
  while ((match = tag.exec(body))) {
    const [all, close, element, doubleQuoted, singleQuoted, selfClosing] = match;
    const name = doubleQuoted ?? singleQuoted;
    if (element === 'field' && !close) { stack.push(unxml(name ?? '')); if (selfClosing) stack.pop(); }
    else if (element === 'field' && close) stack.pop();
    else if (element === 'value' && !close) { if (selfClosing) add(map, stack.filter(Boolean).join('.'), ''); else valueStart = match.index + all.length; }
    else if (valueStart >= 0) { add(map, stack.filter(Boolean).join('.'), unxml(body.slice(valueStart, match.index))); valueStart = -1; }
  }
  return map;
}
