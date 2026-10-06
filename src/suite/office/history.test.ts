import { describe, expect, it } from 'vitest';
import type { DocxModel } from './ooxml';
import {
  canRedoOfficeHistory,
  canUndoOfficeHistory,
  createOfficeHistory,
  currentOfficeHistory,
  recordOfficeHistory,
  redoOfficeHistory,
  undoOfficeHistory,
} from './history';

function model(text:string):DocxModel {
  return { kind:'docx', paragraphs:[text], fidelity:'reflow-warning' };
}

describe('Office per-tab history',()=>{
  it('undoes and redoes model edits with dirty state',()=>{
    let history=createOfficeHistory(model('a'));
    history=recordOfficeHistory(history,model('b'));
    history=recordOfficeHistory(history,model('c'));
    expect(canUndoOfficeHistory(history)).toBe(true);
    history=undoOfficeHistory(history);
    expect((currentOfficeHistory(history).model as DocxModel).paragraphs[0]).toBe('b');
    expect(currentOfficeHistory(history).dirty).toBe(true);
    expect(canRedoOfficeHistory(history)).toBe(true);
    history=redoOfficeHistory(history);
    expect((currentOfficeHistory(history).model as DocxModel).paragraphs[0]).toBe('c');
  });

  it('returns clean state only at the retained original baseline',()=>{
    let history=createOfficeHistory(model('a'));
    history=recordOfficeHistory(history,model('b'));
    history=undoOfficeHistory(history);
    expect(currentOfficeHistory(history).dirty).toBe(false);
  });

  it('drops redo entries after a new edit',()=>{
    let history=createOfficeHistory(model('a'));
    history=recordOfficeHistory(history,model('b'));
    history=undoOfficeHistory(history);
    history=recordOfficeHistory(history,model('x'));
    expect(canRedoOfficeHistory(history)).toBe(false);
    expect((currentOfficeHistory(history).model as DocxModel).paragraphs[0]).toBe('x');
  });

  it('keeps histories independent across document tabs',()=>{
    const tabA=recordOfficeHistory(createOfficeHistory(model('A0')),model('A1'));
    const tabB=createOfficeHistory(model('B0'));
    expect((currentOfficeHistory(tabA).model as DocxModel).paragraphs[0]).toBe('A1');
    expect(currentOfficeHistory(tabA).dirty).toBe(true);
    expect((currentOfficeHistory(tabB).model as DocxModel).paragraphs[0]).toBe('B0');
    expect(currentOfficeHistory(tabB).dirty).toBe(false);
  });

  it('preserves dirty state when the clean baseline is evicted',()=>{
    let history=createOfficeHistory(model('0'),3);
    history=recordOfficeHistory(history,model('1'));
    history=recordOfficeHistory(history,model('2'));
    history=recordOfficeHistory(history,model('3'));
    expect(history.entries).toHaveLength(3);
    expect((history.entries[0].model as DocxModel).paragraphs[0]).toBe('1');
    history=undoOfficeHistory(undoOfficeHistory(history));
    expect(history.cursor).toBe(0);
    expect(currentOfficeHistory(history).dirty).toBe(true);
  });
});
