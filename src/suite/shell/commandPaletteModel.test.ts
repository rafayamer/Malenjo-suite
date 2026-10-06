import { describe, expect, it } from 'vitest';
import {
  CANONICAL_COMMAND_PALETTE_EXAMPLES,
  filterCommandPaletteItems,
  type CommandPaletteSearchItem,
} from './commandPaletteModel';

const items: CommandPaletteSearchItem[] = [
  { id:'action', label:'OCR this document', group:'Actions', keywords:'recognize searchable text' },
  { id:'doc', label:'Quarterly Report.pdf', group:'Documents', keywords:'pdf finance', kind:'document' },
  { id:'setting', label:'Open Settings', group:'Settings', keywords:'preferences appearance', kind:'setting' },
  {
    id:'hidden',
    label:'Convert to Word',
    group:'Source-truth discovery',
    hiddenWhenEmpty:true,
    disabled:true,
    disabledReason:'PDF-to-Word conversion is not operational in this build yet.',
  },
];

describe('suite-wide command palette search', () => {
  it('searches actions, documents and settings', () => {
    expect(filterCommandPaletteItems(items, 'OCR').map((item) => item.id)).toEqual(['action']);
    expect(filterCommandPaletteItems(items, 'Quarterly pdf').map((item) => item.id)).toEqual(['doc']);
    expect(filterCommandPaletteItems(items, 'appearance settings').map((item) => item.id)).toEqual(['setting']);
  });

  it('keeps discovery-only unavailable actions out of the empty palette but searchable by phrase', () => {
    expect(filterCommandPaletteItems(items, '').map((item) => item.id)).not.toContain('hidden');
    const result = filterCommandPaletteItems(items, 'convert word');
    expect(result).toHaveLength(1);
    expect(result[0].disabled).toBe(true);
    expect(result[0].disabledReason).toContain('not operational');
  });

  it('tracks every canonical 53.10 example with an operational destination or explicit unavailable reason', () => {
    expect(CANONICAL_COMMAND_PALETTE_EXAMPLES.map((item) => item.phrase)).toEqual([
      'Compress this PDF',
      'OCR this document',
      'Convert to Word',
      'Add signature',
      'Protect with password',
      'Remove metadata',
      'Scan document',
      'Ask Malenjo AI',
      'Open Security Center',
      'Create invoice',
      'Run automation',
    ]);
    expect(CANONICAL_COMMAND_PALETTE_EXAMPLES.every((item) =>
      Boolean(item.target) !== Boolean(item.unavailableReason),
    )).toBe(true);
  });
});
