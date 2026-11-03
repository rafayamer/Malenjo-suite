/**
 * PDF content stream tokenizer (ISO 32000-1, 7.2 and 8.x). Produces the list
 * of operations with their operands and the byte span of each operation, so
 * an editor can rewrite only the operations it changes and copy every other
 * byte through unchanged. Inline images (BI ... ID ... EI) are kept as one
 * opaque operation.
 */
export type Operand =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'string'; bytes: Uint8Array; hex: boolean }
  | { type: 'bool'; value: boolean }
  | { type: 'null' }
  | { type: 'array'; items: Operand[] }
  | { type: 'dict'; entries: [string, Operand][] };

export interface ContentOp { op: string; operands: Operand[]; start: number; end: number }

const WHITE = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

export class ContentSyntaxError extends Error {}

export function tokenizeContent(data: Uint8Array): ContentOp[] {
  let i = 0;
  const ops: ContentOp[] = [];
  let operands: Operand[] = [];
  let opStart = -1;
  const skipSpace = () => {
    while (i < data.length) {
      if (WHITE.has(data[i])) { i++; continue; }
      if (data[i] === 37) { while (i < data.length && data[i] !== 10 && data[i] !== 13) i++; continue; } // % comment
      break;
    }
  };
  const regular = () => { const s = i; while (i < data.length && !WHITE.has(data[i]) && !DELIM.has(data[i])) i++; return String.fromCharCode(...data.subarray(s, i)); };

  function literalString(): Operand {
    i++; // (
    const out: number[] = [];
    let depth = 1;
    while (i < data.length) {
      const c = data[i++];
      if (c === 92) { // backslash
        const n = data[i++];
        const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (n in map) out.push(map[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2 && data[i] >= 48 && data[i] <= 55; k++) v = v * 8 + (data[i++] - 48);
          out.push(v & 255);
        } else if (n === 13) { if (data[i] === 10) i++; } else if (n !== 10) out.push(n);
        continue;
      }
      if (c === 40) depth++;
      if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return { type: 'string', bytes: Uint8Array.from(out), hex: false };
  }
  function hexString(): Operand {
    i++; // <
    const digits: number[] = [];
    while (i < data.length && data[i] !== 62) { const c = data[i++]; if (!WHITE.has(c)) digits.push(c); }
    i++; // >
    const text = String.fromCharCode(...digits) + (digits.length % 2 ? '0' : '');
    const bytes = new Uint8Array(text.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(text.slice(k * 2, k * 2 + 2), 16) || 0;
    return { type: 'string', bytes, hex: true };
  }
  function object(): Operand | string {
    skipSpace();
    const c = data[i];
    if (c === 40) return literalString();
    if (c === 60 && data[i + 1] === 60) {
      i += 2;
      const entries: [string, Operand][] = [];
      for (;;) {
        skipSpace();
        if (data[i] === 62 && data[i + 1] === 62) { i += 2; break; }
        if (i >= data.length) throw new ContentSyntaxError('Unterminated dictionary.');
        const key = object();
        const value = object();
        if (typeof key === 'string' || key.type !== 'name' || typeof value === 'string') throw new ContentSyntaxError('Bad dictionary.');
        entries.push([key.value, value]);
      }
      return { type: 'dict', entries };
    }
    if (c === 60) return hexString();
    if (c === 91) {
      i++;
      const items: Operand[] = [];
      for (;;) {
        skipSpace();
        if (data[i] === 93) { i++; break; }
        if (i >= data.length) throw new ContentSyntaxError('Unterminated array.');
        const item = object();
        if (typeof item === 'string') throw new ContentSyntaxError(`Operator ${item} inside an array.`);
        items.push(item);
      }
      return { type: 'array', items };
    }
    if (c === 47) { i++; return { type: 'name', value: decodeName(regular()) }; }
    const word = regular();
    if (!word) { i++; throw new ContentSyntaxError(`Unexpected character ${String.fromCharCode(c)}.`); }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { type: 'number', value: Number(word) };
    if (word === 'true' || word === 'false') return { type: 'bool', value: word === 'true' };
    if (word === 'null') return { type: 'null' };
    return word; // an operator
  }

  for (;;) {
    skipSpace();
    if (i >= data.length) break;
    if (opStart < 0) opStart = i;
    const token = object();
    if (typeof token !== 'string') { operands.push(token); continue; }
    if (token === 'BI') {
      // Inline image: skip to whitespace-delimited EI after ID.
      const id = indexOfWord(data, 'ID', i);
      let end = id + 2;
      for (;;) {
        end = indexOfWord(data, 'EI', end + 1);
        if (end < 0) throw new ContentSyntaxError('Unterminated inline image.');
        if (WHITE.has(data[end - 1]) && (end + 2 >= data.length || WHITE.has(data[end + 2]))) break;
      }
      i = end + 2;
      ops.push({ op: 'BI', operands: [], start: opStart, end: i });
    } else {
      ops.push({ op: token, operands, start: opStart, end: i });
    }
    operands = []; opStart = -1;
  }
  return ops;
}

function indexOfWord(data: Uint8Array, word: string, from: number): number {
  const a = word.charCodeAt(0), b = word.charCodeAt(1);
  for (let k = from; k < data.length - 1; k++) if (data[k] === a && data[k + 1] === b) return k;
  return -1;
}
function decodeName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---- serialization ----
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));
function encodeName(name: string): string {
  return '/' + [...name].map((ch) => { const c = ch.charCodeAt(0); return c < 33 || c > 126 || '()<>[]{}/%#'.includes(ch) ? '#' + c.toString(16).padStart(2, '0') : ch; }).join('');
}
export function serializeOperand(o: Operand): string {
  switch (o.type) {
    case 'number': return num(o.value);
    case 'name': return encodeName(o.value);
    case 'bool': return String(o.value);
    case 'null': return 'null';
    case 'string': return '<' + Array.from(o.bytes, (b) => b.toString(16).padStart(2, '0')).join('') + '>';
    case 'array': return '[' + o.items.map(serializeOperand).join(' ') + ']';
    case 'dict': return '<<' + o.entries.map(([k, v]) => `${encodeName(k)} ${serializeOperand(v)}`).join(' ') + '>>';
  }
}
export function serializeOp(op: Pick<ContentOp, 'op' | 'operands'>): string {
  return [...op.operands.map(serializeOperand), op.op].join(' ');
}

/**
 * Rebuilds a content stream: operations listed in `replace` are written from
 * their new text (an empty string deletes them); every other byte is copied.
 */
export function rewriteContent(data: Uint8Array, ops: ContentOp[], replace: Map<number, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  let cursor = 0;
  const encoder = new TextEncoder();
  ops.forEach((op, index) => {
    if (!replace.has(index)) return;
    parts.push(data.subarray(cursor, op.start));
    parts.push(encoder.encode(replace.get(index)!));
    cursor = op.end;
  });
  parts.push(data.subarray(cursor));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
