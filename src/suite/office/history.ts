import type { OfficeModel } from './ooxml';

export interface OfficeHistoryEntry {
  model: OfficeModel;
  dirty: boolean;
}

export interface OfficeHistory {
  entries: OfficeHistoryEntry[];
  cursor: number;
  maxEntries: number;
}

function cloneModel(model: OfficeModel): OfficeModel {
  return structuredClone(model);
}

function cloneEntry(entry: OfficeHistoryEntry): OfficeHistoryEntry {
  return { model:cloneModel(entry.model), dirty:entry.dirty };
}

export function createOfficeHistory(initial: OfficeModel, maxEntries = 80): OfficeHistory {
  return {
    entries:[{ model:cloneModel(initial), dirty:false }],
    cursor:0,
    maxEntries:Math.max(2,maxEntries),
  };
}

export function canUndoOfficeHistory(history: OfficeHistory): boolean {
  return history.cursor > 0;
}

export function canRedoOfficeHistory(history: OfficeHistory): boolean {
  return history.cursor < history.entries.length - 1;
}

export function currentOfficeHistory(history: OfficeHistory): OfficeHistoryEntry {
  return cloneEntry(history.entries[history.cursor]);
}

export function recordOfficeHistory(history: OfficeHistory, next: OfficeModel): OfficeHistory {
  const prefix = history.entries.slice(0, history.cursor + 1);
  const entries = [...prefix, { model:cloneModel(next), dirty:true }];
  const overflow = Math.max(0, entries.length - history.maxEntries);
  const bounded = overflow ? entries.slice(overflow) : entries;
  return {
    ...history,
    entries:bounded,
    cursor:bounded.length - 1,
  };
}

export function undoOfficeHistory(history: OfficeHistory): OfficeHistory {
  if (!canUndoOfficeHistory(history)) return history;
  return { ...history, cursor:history.cursor - 1 };
}

export function redoOfficeHistory(history: OfficeHistory): OfficeHistory {
  if (!canRedoOfficeHistory(history)) return history;
  return { ...history, cursor:history.cursor + 1 };
}
