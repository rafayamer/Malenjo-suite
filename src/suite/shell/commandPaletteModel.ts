import type { ModuleId } from '../core/types';

export type CommandPaletteKind = 'action' | 'document' | 'setting';

export interface CommandPaletteSearchItem {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  detail?: string;
  kind?: CommandPaletteKind;
  hiddenWhenEmpty?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export interface CanonicalCommandPaletteExample {
  phrase: string;
  target?: ModuleId;
  unavailableReason?: string;
  detail?: string;
  keywords?: string;
}

export const CANONICAL_COMMAND_PALETTE_EXAMPLES: CanonicalCommandPaletteExample[] = [
  {
    phrase: 'Compress this PDF',
    unavailableReason: 'PDF compression is not operational in this build yet.',
    keywords: 'compress optimize reduce pdf size',
  },
  {
    phrase: 'OCR this document',
    target: 'ocr',
    detail: 'Open the OCR workspace to choose a document for OCR.',
    keywords: 'recognize searchable text ocr document',
  },
  {
    phrase: 'Convert to Word',
    unavailableReason: 'PDF-to-Word conversion is not operational in this build yet.',
    keywords: 'convert export pdf docx word',
  },
  {
    phrase: 'Add signature',
    target: 'sign',
    detail: 'Open the Sign workspace to choose a PDF and place or validate supported signatures.',
    keywords: 'signature certificate sign pdf',
  },
  {
    phrase: 'Protect with password',
    unavailableReason: 'Password-protection workflow is not operational in this build yet.',
    keywords: 'protect encrypt password pdf security',
  },
  {
    phrase: 'Remove metadata',
    target: 'metadata',
    detail: 'Open Metadata Studio to choose a document, review metadata and apply supported sanitization.',
    keywords: 'remove metadata sanitize privacy exif xmp pdf ooxml',
  },
  {
    phrase: 'Scan document',
    target: 'scanner',
    detail: 'Open the Scanner workspace.',
    keywords: 'scan camera capture document',
  },
  {
    phrase: 'Ask Malenjo AI',
    target: 'ai',
    detail: 'Open the local-first Malenjo AI workspace.',
    keywords: 'ai local rag ollama llama ask document',
  },
  {
    phrase: 'Open Security Center',
    target: 'security',
    detail: 'Open Security Center.',
    keywords: 'security protect sanitize malware audit',
  },
  {
    phrase: 'Create invoice',
    unavailableReason: 'Invoice Studio is still an adapter; invoice creation is not operational yet.',
    keywords: 'invoice create billing template',
  },
  {
    phrase: 'Run automation',
    target: 'automation',
    detail: 'Open Automation Studio to select and run an implemented workflow.',
    keywords: 'automation workflow temporal run',
  },
];

function searchableText(item: CommandPaletteSearchItem): string {
  return [item.label, item.group, item.keywords ?? '', item.detail ?? '', item.disabledReason ?? '']
    .join(' ')
    .toLowerCase();
}

export function filterCommandPaletteItems<T extends CommandPaletteSearchItem>(
  items: T[],
  query: string,
  emptyLimit = 30,
  queryLimit = 40,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items.filter((item) => !item.hiddenWhenEmpty).slice(0, emptyLimit);

  const terms = normalized.split(/\s+/).filter(Boolean);
  return items
    .filter((item) => {
      const haystack = searchableText(item);
      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, queryLimit);
}
