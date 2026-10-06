import type { OfficeModel } from './ooxml';

export interface OfficeHistory {
  entries: OfficeModel[];
  cursor: number;
  maxEntries: number;
}

function cloneModel(model: OfficeModel): OfficeModel {
  return structuredClone(model);
}

export function createOfficeHistory(initial: OfficeModel, maxEntries = 80): OfficeHistory {
  return { entries:[cloneModel(initial)], cursor:0, maxEntries:Math.max(2,maxEntries) };
}

export function canUndoOfficeHistory(history: OfficeHistory): boolean {
  return history.cursor > 0;
}

export function canRedoOfficeHistory(history: OfficeHistory): boolean {
  return history.cursor < history.entries.length - 1;
}

export function currentOfficeHistory(history: OfficeHistory): OfficeModel {
  return cloneModel(history.entries[history.cursor]);
}

export function recordOfficeHistory(history: OfficeHistory, next: OfficeModel): OfficeHistory {
  const prefix = history.entries.slice(0, history.cursor + 1);
  const entries = [...prefix, cloneModel(next)];
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
