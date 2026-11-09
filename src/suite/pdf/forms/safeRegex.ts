/**
 * A linear-time matcher for the regular expressions form fields use for validation.
 *
 * Patterns come from documents and run while the user fills a form, so they are never handed to the
 * browser's backtracking engine: a pattern such as (a+)+ or (a+){20} can take exponential time there.
 * Instead a supported subset is compiled to a Thompson NFA and simulated state-set by state-set, which takes
 * time proportional to pattern size × value length whatever the pattern.
 *
 * Supported: literals and escapes (\d \D \w \W \s \S \. \n \t \r \xHH \uHHHH and escaped punctuation),
 * character classes with ranges and negation, ".", anchors ^ and $, groups ( ) and (?: ), alternation |,
 * and the quantifiers * + ? {n} {n,} {n,m} (lazy forms behave the same for a yes/no test). Not supported
 * (the pattern is then not run): back-references, lookaround, named groups, word boundaries and flags.
 */

type Test = (ch: string) => boolean;
type Ast =
  | { k: 'set'; test: Test } | { k: 'bol' } | { k: 'eol' } | { k: 'empty' }
  | { k: 'seq'; items: Ast[] } | { k: 'alt'; items: Ast[] } | { k: 'rep'; node: Ast; min: number; max: number };
type State =
  | { t: 'set'; test: Test; out: number } | { t: 'split'; a: number; b: number }
  | { t: 'bol'; out: number } | { t: 'eol'; out: number } | { t: 'match' };

class Unsupported extends Error {}
const MAX_STATES = 5000, MAX_REPEAT = 100, MAX_BUILD_STEPS = 50_000;

const DIGIT: Test = (c) => c >= '0' && c <= '9';
const WORD: Test = (c) => /[A-Za-z0-9_]/.test(c);
const SPACE: Test = (c) => /\s/.test(c);
const not = (t: Test): Test => (c) => !t(c);
const LINE_END = new Set(['\n', '\r', ' ', ' ']);

function parse(source: string): Ast {
  let i = 0;
  const peek = () => source[i];
  const hex = (n: number) => {
    const digits = source.slice(i, i + n);
    if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(digits)) throw new Unsupported();
    i += n;
    return String.fromCharCode(parseInt(digits, 16));
  };
  /** An escape after the backslash: a class test, or a single literal character. */
  const escape = (): Test | string => {
    const c = source[i++];
    if (c === undefined) throw new Unsupported();
    switch (c) {
      case 'd': return DIGIT; case 'D': return not(DIGIT);
      case 'w': return WORD; case 'W': return not(WORD);
      case 's': return SPACE; case 'S': return not(SPACE);
      case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r'; case 'f': return '\f'; case 'v': return '\v';
      case 'x': return hex(2); case 'u': return hex(4);
      default:
        // Back-references, word boundaries, control escapes and named escapes are not supported.
        if (/[0-9bBcpPk]/.test(c)) throw new Unsupported();
        return c;
    }
  };
  const literal = (ch: string): Test => (c) => c === ch;
  const klass = (): Test => {
    const negate = peek() === '^'; if (negate) i++;
    // "[]" and "[^]" mean different things in different engines: not supported.
    if (peek() === ']') throw new Unsupported();
    const parts: Test[] = [];
    while (i < source.length && source[i] !== ']') {
      let lo: Test | string = source[i++] === '\\' ? escape() : source[i - 1];
      if (typeof lo === 'string' && peek() === '-' && source[i + 1] !== undefined && source[i + 1] !== ']') {
        i++;
        const hi = source[i++] === '\\' ? escape() : source[i - 1];
        if (typeof hi !== 'string' || hi < lo) throw new Unsupported();
        const [a, b] = [lo, hi];
        parts.push((c) => c >= a && c <= b);
        continue;
      }
      parts.push(typeof lo === 'string' ? literal(lo) : lo);
    }
    if (source[i++] !== ']') throw new Unsupported();
    const any: Test = (c) => parts.some((p) => p(c));
    return negate ? not(any) : any;
  };
  const atom = (): Ast => {
    const c = source[i++];
    if (c === '(') {
      if (source.startsWith('?:', i)) i += 2;
      else if (peek() === '?') throw new Unsupported(); // lookaround or named group
      const inner = alt();
      if (source[i++] !== ')') throw new Unsupported();
      return inner;
    }
    if (c === '[') return { k: 'set', test: klass() };
    if (c === '.') return { k: 'set', test: (ch) => !LINE_END.has(ch) };
    if (c === '^') return { k: 'bol' };
    if (c === '$') return { k: 'eol' };
    if (c === '\\') { const e = escape(); return { k: 'set', test: typeof e === 'string' ? literal(e) : e }; }
    if (c === '*' || c === '+' || c === '?') throw new Unsupported(); // nothing to repeat
    return { k: 'set', test: literal(c) };
  };
  const quantified = (): Ast => {
    let node = atom();
    for (;;) {
      const c = peek();
      let min: number, max: number;
      if (c === '*') { min = 0; max = Infinity; i++; }
      else if (c === '+') { min = 1; max = Infinity; i++; }
      else if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '{' && /^\{\d+(,\d*)?\}/.test(source.slice(i))) {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i))!;
        min = Number(m[1]); max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
        if (max < min) throw new Unsupported();
        i += m[0].length;
      } else return node;
      if (min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) throw new Unsupported();
      if (peek() === '?') i++; // lazy: same result for a yes/no test
      if (node.k === 'bol' || node.k === 'eol') throw new Unsupported();
      node = { k: 'rep', node, min, max };
    }
  };
  const seq = (): Ast => {
    const items: Ast[] = [];
    while (i < source.length && peek() !== '|' && peek() !== ')') items.push(quantified());
    return items.length === 1 ? items[0] : items.length ? { k: 'seq', items } : { k: 'empty' };
  };
  const alt = (): Ast => {
    const items = [seq()];
    while (peek() === '|') { i++; items.push(seq()); }
    return items.length === 1 ? items[0] : { k: 'alt', items };
  };
  const ast = alt();
  if (i !== source.length) throw new Unsupported();
  return ast;
}

function compile(ast: Ast): State[] {
  const states: State[] = [{ t: 'match' }];
  const add = (s: State) => { if (states.length >= MAX_STATES) throw new Unsupported(); states.push(s); return states.length - 1; };
  // Builds backwards: returns the start state of `node` followed by `next`. Every call counts toward a budget, so
  // nested repeats of an empty expression (which emit no states) cannot make compiling itself take forever.
  let steps = 0;
  const build = (node: Ast, next: number): number => {
    if (++steps > MAX_BUILD_STEPS) throw new Unsupported();
    switch (node.k) {
      case 'empty': return next;
      case 'set': return add({ t: 'set', test: node.test, out: next });
      case 'bol': return add({ t: 'bol', out: next });
      case 'eol': return add({ t: 'eol', out: next });
      case 'seq': { let at = next; for (let k = node.items.length - 1; k >= 0; k--) at = build(node.items[k], at); return at; }
      case 'alt': {
        const starts = node.items.map((item) => build(item, next));
        let at = starts[starts.length - 1];
        for (let k = starts.length - 2; k >= 0; k--) at = add({ t: 'split', a: starts[k], b: at });
        return at;
      }
      case 'rep': {
        let tail: number;
        if (node.max === Infinity) {
          const loop = add({ t: 'split', a: -1, b: next });
          (states[loop] as { a: number }).a = build(node.node, loop);
          tail = loop;
        } else {
          tail = next;
          for (let k = 0; k < node.max - node.min; k++) tail = add({ t: 'split', a: build(node.node, tail), b: next });
        }
        for (let k = 0; k < node.min; k++) tail = build(node.node, tail);
        return tail;
      }
    }
  };
  const start = build(ast, 0);
  states.push({ t: 'split', a: start, b: start }); // the last state is the entry
  return states;
}

export interface SafeRegex { test(value: string): boolean }

/** Compiles a pattern for linear-time matching, or returns null when it uses anything outside the subset. */
export function compileSafeRegex(pattern: string): SafeRegex | null {
  if (!pattern || pattern.length > 200) return null;
  let states: State[];
  try { states = compile(parse(pattern)); } catch (error) { if (error instanceof Unsupported) return null; throw error; }
  const entry = states.length - 1;
  return {
    test(value: string): boolean {
      const n = value.length;
      // Adds a state and everything reachable from it without consuming a character.
      const close = (set: Set<number>, from: number, pos: number): boolean => {
        const stack = [from];
        while (stack.length) {
          const s = stack.pop()!;
          if (set.has(s)) continue;
          set.add(s);
          const st = states[s];
          if (st.t === 'match') return true;
          if (st.t === 'split') stack.push(st.b, st.a);
          else if (st.t === 'bol') { if (pos === 0) stack.push(st.out); }
          else if (st.t === 'eol') { if (pos === n) stack.push(st.out); }
        }
        return false;
      };
      let current = new Set<number>();
      // An unanchored search: a match may start at any position.
      if (close(current, entry, 0)) return true;
      for (let pos = 0; pos < n; pos++) {
        const ch = value[pos];
        const next = new Set<number>();
        for (const s of current) {
          const st = states[s];
          if (st.t === 'set' && st.test(ch) && close(next, st.out, pos + 1)) return true;
        }
        if (close(next, entry, pos + 1)) return true;
        current = next;
      }
      return false;
    },
  };
}
