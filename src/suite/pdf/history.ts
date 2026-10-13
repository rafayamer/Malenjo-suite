export interface PdfHistoryEntry {
  bytes: Uint8Array;
  page: number;
  label: string;
  dirty: boolean;
}

export interface PdfHistory {
  entries: PdfHistoryEntry[];
  cursor: number;
  totalBytes: number;
  maxEntries: number;
  maxBytes: number;
}

export interface PdfHistoryTransition {
  history: PdfHistory;
  entry: PdfHistoryEntry;
  changed: boolean;
}

export const PDF_HISTORY_DEFAULTS = {
  // Initial version was 12 snapshots. Keep up to 30 reversible edits plus
  // the baseline, subject to a per-document memory ceiling.
  maxEntries: 31,
  maxBytes: 256 * 1024 * 1024,
} as const;

function owned(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

function normalizePage(page: number): number {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function total(entries: PdfHistoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
}

export function createPdfHistory(
  bytes: Uint8Array,
  page = 1,
  options: Partial<Pick<PdfHistory, 'maxEntries' | 'maxBytes'>> = {},
): PdfHistory {
  const entry: PdfHistoryEntry = {
    bytes: owned(bytes),
    page: normalizePage(page),
    label: 'Original document',
    dirty: false,
  };
  return {
    entries: [entry],
    cursor: 0,
    totalBytes: entry.bytes.byteLength,
    maxEntries: Math.max(2, options.maxEntries ?? PDF_HISTORY_DEFAULTS.maxEntries),
    maxBytes: Math.max(1, options.maxBytes ?? PDF_HISTORY_DEFAULTS.maxBytes),
  };
}

export function currentPdfHistoryEntry(history: PdfHistory): PdfHistoryEntry {
  const entry = history.entries[history.cursor];
  if (!entry) throw new Error('PDF history has no current entry.');
  return entry;
}

export function canUndoPdfHistory(history: PdfHistory): boolean {
  return history.cursor > 0;
}

export function canRedoPdfHistory(history: PdfHistory): boolean {
  return history.cursor < history.entries.length - 1;
}

export function recordPdfHistory(
  history: PdfHistory,
  bytes: Uint8Array,
  page: number,
  label: string,
): PdfHistory {
  // Entries already own their immutable byte snapshots. Re-cloning every prior
  // PDF on every edit was quadratic in both retained edits and file size.
  const retained = history.entries.slice(0, history.cursor + 1);
  retained.push({
    bytes: owned(bytes),
    page: normalizePage(page),
    label: label.trim().slice(0, 160) || 'PDF edit',
    dirty: true,
  });

  let cursor = retained.length - 1;
  let retainedBytes = total(retained);

  while (
    retained.length > 2
    && (retained.length > history.maxEntries || retainedBytes > history.maxBytes)
  ) {
    retainedBytes -= retained[0].bytes.byteLength;
    retained.shift();
    cursor -= 1;
  }

  return {
    ...history,
    entries: retained,
    cursor: Math.max(0, cursor),
    totalBytes: retainedBytes,
  };
}

function move(history: PdfHistory, cursor: number): PdfHistoryTransition {
  if (cursor === history.cursor || cursor < 0 || cursor >= history.entries.length) {
    return { history, entry: currentPdfHistoryEntry(history), changed: false };
  }
  const next: PdfHistory = { ...history, cursor };
  return { history: next, entry: currentPdfHistoryEntry(next), changed: true };
}

export function undoPdfHistory(history: PdfHistory): PdfHistoryTransition {
  return move(history, history.cursor - 1);
}

export function redoPdfHistory(history: PdfHistory): PdfHistoryTransition {
  return move(history, history.cursor + 1);
}
