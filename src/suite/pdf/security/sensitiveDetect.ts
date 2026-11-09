/**
 * Smart sensitive-information detection (MAL-064). Runs locally over the page text, with the same glyph geometry
 * the redaction uses, and proposes candidates for the user to review. It is rule-based (patterns, check digits and
 * a short list of name and address cues), not a machine-learning model: it finds what the rules describe, and the
 * user reviews every candidate before anything is redacted.
 */
import { marksForRange, readPagesText, type RedactionMark } from './pdfRedact';

export type SensitiveCategory = 'email' | 'phone' | 'national-id' | 'card' | 'bank' | 'name' | 'address' | 'date' | 'custom';
export const SENSITIVE_CATEGORIES: [SensitiveCategory, string][] = [
  ['name', 'Names'], ['address', 'Addresses and postcodes'], ['email', 'Email addresses'], ['phone', 'Phone numbers'],
  ['national-id', 'National identity numbers'], ['card', 'Payment card numbers'], ['bank', 'Bank account numbers (IBAN)'],
  ['date', 'Dates of birth'], ['custom', 'Your own patterns'],
];
export interface SensitiveCandidate { id: number; category: SensitiveCategory; text: string; pageNumber: number; marks: RedactionMark[]; reason: string }

const digits = (s: string) => s.replace(/\D/g, '');
/** Luhn check for payment card numbers. */
export function luhn(number: string): boolean {
  const d = digits(number);
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}
/** ISO 13616 mod-97 check for IBANs. */
export function ibanValid(value: string): boolean {
  const s = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of moved) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
/** Verhoeff check digit (Aadhaar). */
export function verhoeff(number: string): boolean {
  let c = 0;
  [...digits(number)].reverse().forEach((d, i) => { c = VD[c][VP[i % 8][Number(d)]]; });
  return c === 0;
}

const GIVEN = 'James John Robert Michael William David Richard Joseph Thomas Charles Christopher Daniel Matthew Anthony Mark Donald Steven Paul Andrew Joshua Kenneth Kevin Brian George Timothy Ronald Edward Jason Jeffrey Ryan Jacob Gary Nicholas Eric Jonathan Stephen Larry Justin Scott Brandon Benjamin Samuel Gregory Alexander Patrick Frank Raymond Jack Dennis Jerry Tyler Aaron Jose Adam Nathan Henry Peter Zachary Douglas Harold Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Margaret Sandra Ashley Kimberly Emily Donna Michelle Carol Amanda Dorothy Melissa Deborah Stephanie Rebecca Sharon Laura Cynthia Kathleen Amy Angela Shirley Anna Brenda Pamela Emma Nicole Helen Samantha Katherine Christine Debra Rachel Carolyn Janet Catherine Maria Heather Diane Ruth Julie Olivia Joyce Virginia Victoria Kelly Lauren Christina Joan Evelyn Judith Megan Andrea Cheryl Hannah Jacqueline Martha Gloria Teresa Ann Sara Madison Frances Kathryn Janice Jean Abigail Alice Julia Judy Sophia Grace Denise Amber Doris Marilyn Danielle Beverly Isabella Theresa Diana Natalie Brittany Charlotte Marie Kayla Alexis Lori Jane Ahmed Ali Muhammad Mohammed Fatima Aisha Omar Hassan Hussain Usman Bilal Ayesha Zainab Imran Rafay Amer Sara Hamza Yusuf Ibrahim Khalid Mariam Noor Raj Priya Amit Anil Sunita Wei Li Ming Chen Yuki Hiroshi Kenji Carlos Juan Luis Ana Sofia Pedro Miguel Pierre Jean Marie Hans Klaus Anna Lars Olga Ivan Dmitri'.split(' ');
const GIVEN_SET = new Set(GIVEN);
const TITLES = '(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Rev)\\.?';
const CAP = "[A-Z][a-z\\u00C0-\\u024F'’-]+";
const STREET = '(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Square|Sq|Terrace|Close|Crescent|Highway|Hwy|Parkway|Pkwy)\\.?';

interface Rule { category: SensitiveCategory; pattern: RegExp; reason: string; accept?(match: string): boolean; group?: number }
const RULES: Rule[] = [
  { category: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, reason: 'Email address' },
  { category: 'card', pattern: /\b(?:\d[ -]?){12,18}\d\b/g, reason: 'Card number (passes the Luhn check)', accept: luhn },
  { category: 'bank', pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, reason: 'IBAN (passes the mod-97 check)', accept: ibanValid },
  { category: 'national-id', pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, reason: 'US Social Security number' },
  { category: 'national-id', pattern: /\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g, reason: 'UK National Insurance number' },
  { category: 'national-id', pattern: /\b\d{5}-\d{7}-\d\b/g, reason: 'Pakistani CNIC' },
  { category: 'national-id', pattern: /(?<!\d[ -]?)\b[2-9]\d{3} \d{4} \d{4}\b(?![ -]?\d)/g, reason: 'Aadhaar number (passes the Verhoeff check)', accept: verhoeff },
  { category: 'phone', pattern: /(?<![\w+]|\d[ .-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}[ .-]\d{3,4}(?:[ .-]\d{2,4})?(?![\w-]|[ .-]\d)/g, reason: 'Phone number',
    accept: (m) => { const n = digits(m).length; return n >= 9 && n <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(m) && !luhn(m); } },
  { category: 'date', pattern: /\b(?:born|DOB|date of birth|birth ?date)\s*:?\s*((?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4})|(?:\d{1,2} [A-Z][a-z]{2,8} \d{4})|(?:[A-Z][a-z]{2,8} \d{1,2},? \d{4})|(?:\d{4}-\d{2}-\d{2}))/gi, reason: 'Date of birth', group: 1 },
  { category: 'name', pattern: new RegExp(`\\b${TITLES} ${CAP}(?: ${CAP}){0,2}`, 'g'), reason: 'Name after a title' },
  { category: 'name', pattern: new RegExp(`\\b(?:Name|Patient|Employee|Client|Customer|Applicant|Signed|Recipient|Beneficiary)\\s*:\\s*(${CAP}(?: (?:[A-Z]\\.|${CAP})){1,3})`, 'g'), reason: 'Name after a label', group: 1 },
  { category: 'name', pattern: new RegExp(`\\b(${CAP})(?: [A-Z]\\.)? (${CAP})\\b`, 'g'), reason: 'Common given name followed by a surname', accept: (m) => GIVEN_SET.has(m.split(' ')[0]) },
  { category: 'address', pattern: new RegExp(`\\b\\d{1,5}[A-Za-z]? (?:${CAP} ){1,4}${STREET}(?:,? (?:${CAP} ?){1,3})?`, 'g'), reason: 'Street address' },
  { category: 'address', pattern: /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g, reason: 'UK postcode' },
  { category: 'address', pattern: /\b(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[AEDINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]) \d{5}(?:-\d{4})?\b/g, reason: 'US state and ZIP code' },
];

/** A user's own pattern: a plain phrase, or /regex/ between slashes. Nested repetition is refused (it can hang). */
export function customRule(line: string): RegExp {
  const regex = /^\/(.+)\/([i]?)$/.exec(line.trim());
  if (!regex) return new RegExp(line.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
  if (regex[1].length > 200 || /\([^)]*[+*}][^)]*\)[+*{]/.test(regex[1])) throw new Error('That pattern is too complex; avoid repeating a group that itself repeats.');
  try { return new RegExp(regex[1], `g${regex[2]}u`); } catch { throw new Error(`“${line}” is not a valid pattern.`); }
}

export async function detectSensitiveInformation(bytes: Uint8Array, categories: SensitiveCategory[], customLines: string[] = []): Promise<SensitiveCandidate[]> {
  if (!categories.length) throw new Error('Choose at least one kind of information to look for.');
  const custom = categories.includes('custom') ? customLines.map((l) => l.trim()).filter(Boolean).slice(0, 50).map(customRule) : [];
  const rules: Rule[] = [...RULES.filter((r) => categories.includes(r.category)), ...custom.map((pattern) => ({ category: 'custom' as const, pattern, reason: 'Matches your pattern' }))];
  const pages = await readPagesText(bytes);
  const out: SensitiveCandidate[] = [];
  pages.forEach((page, index) => {
    const taken: [number, number][] = [];
    for (const rule of rules) {
      for (const m of page.text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g'))) {
        const text = rule.group ? m[rule.group] : m[0];
        if (!text || (rule.accept && !rule.accept(text))) continue;
        const start = m.index! + (rule.group ? m[0].indexOf(text) : 0); const end = start + text.length;
        // One candidate per stretch of text: the first rule that claims it wins (rules run most specific first).
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        taken.push([start, end]);
        const marks = marksForRange(page, index + 1, start, end);
        if (marks.length) out.push({ id: out.length, category: rule.category, text: text.replace(/\s+/g, ' ').trim(), pageNumber: index + 1, marks, reason: rule.reason });
      }
    }
  });
  return out;
}
