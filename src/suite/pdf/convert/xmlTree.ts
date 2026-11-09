/* A small, safe XML/HTML tree parser for document conversion (Office packages and HTML).
 * No entity expansion beyond the predefined and numeric ones, no DTDs, no scripts: markup is
 * only read. HTML mode is tolerant (void elements, implied closes, raw-text elements).
 */
export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const AUTO_CLOSE: Record<string, string[]> = { p: ['p', 'div', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr'], li: ['li'], tr: ['tr'], td: ['td', 'th', 'tr'], th: ['td', 'th', 'tr'], option: ['option'] };
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', euro: '€', bull: '•', middot: '·' };
export const decodeEntities = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
  if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return NAMED[code.toLowerCase()] ?? all;
});

export function parseMarkup(source: string, html = false): XNode {
  if (source.length > 50 * 1024 * 1024) throw new Error('The document is too large to convert.');
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const top = () => stack[stack.length - 1];
  const text = (t: string) => { if (t) top().children.push({ name: '#text', attrs: {}, children: [], text: decodeEntities(t) }); };
  let i = 0; let nodes = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) { text(source.slice(i)); break; }
    text(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) { const end = source.indexOf('-->', lt + 4); i = end < 0 ? source.length : end + 3; continue; }
    if (source.startsWith('<![CDATA[', lt)) { const end = source.indexOf(']]>', lt); top().children.push({ name: '#text', attrs: {}, children: [], text: source.slice(lt + 9, end < 0 ? source.length : end) }); i = end < 0 ? source.length : end + 3; continue; }
    if (source[lt + 1] === '!' || source[lt + 1] === '?') { const end = source.indexOf('>', lt); i = end < 0 ? source.length : end + 1; continue; }
    const end = tagEnd(source, lt + 1);
    if (end < 0) { text(source.slice(lt)); break; }
    const tag = source.slice(lt + 1, end);
    i = end + 1;
    if (tag.startsWith('/')) {
      const name = html ? tag.slice(1).trim().toLowerCase() : tag.slice(1).trim();
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const match = /^([^\s/>]+)([\s\S]*?)(\/?)\s*$/.exec(tag);
    if (!match) continue;
    const name = html ? match[1].toLowerCase() : match[1];
    const attrs: Record<string, string> = {};
    for (const a of match[2].matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[html ? a[1].toLowerCase() : a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    // Implied closes repeat: a new <tr> closes the open cell and then its row.
    if (html) for (let closed = true; closed && stack.length > 1;) closed = !!AUTO_CLOSE[top().name]?.includes(name) && !!stack.pop();
    const node: XNode = { name, attrs, children: [], text: '' };
    if (++nodes > 500_000) throw new Error('The document has too many elements to convert.');
    top().children.push(node);
    if (match[3] || (html && VOID.has(name))) continue;
    if (html && RAW.has(name)) {
      const close = source.toLowerCase().indexOf(`</${name}`, i);
      node.children.push({ name: '#text', attrs: {}, children: [], text: source.slice(i, close < 0 ? source.length : close) });
      i = close < 0 ? source.length : source.indexOf('>', close) + 1;
      continue;
    }
    stack.push(node);
  }
  return root;
}

/** Descendants with this name (prefix-insensitive when `name` has no colon). */
export function all(node: XNode, name: string): XNode[] {
  const out: XNode[] = [];
  const match = (n: string) => n === name || (!name.includes(':') && n.endsWith(':' + name));
  const walk = (n: XNode) => { for (const c of n.children) { if (match(c.name)) out.push(c); walk(c); } };
  walk(node);
  return out;
}
export const child = (node: XNode | undefined, name: string) => node?.children.find((c) => c.name === name);
export const kids = (node: XNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];
export const textOf = (node: XNode): string => node.name === '#text' ? node.text : node.children.map(textOf).join('');

/** Index of the `>` that ends a tag, skipping any inside quoted attribute values; -1 if there is none. */
function tagEnd(source: string, from: number): number {
  let quote = '';
  for (let k = from; k < source.length; k++) {
    const ch = source[k];
    if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') return k;
  }
  // An unbalanced quote (malformed markup): fall back to the first '>'.
  return source.indexOf('>', from);
}
