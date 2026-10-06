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
  it('undoes and redoes model edits',()=>{
    let history=createOfficeHistory(model('a'));
    history=recordOfficeHistory(history,model('b'));
    history=recordOfficeHistory(history,model('c'));
    expect(canUndoOfficeHistory(history)).toBe(true);
    history=undoOfficeHistory(history);
    expect((currentOfficeHistory(history) as DocxModel).paragraphs[0]).toBe('b');
    expect(canRedoOfficeHistory(history)).toBe(true);
    history=redoOfficeHistory(history);
    expect((currentOfficeHistory(history) as DocxModel).paragraphs[0]).toBe('c');
  });

  it('drops redo entries after a new edit',()=>{
    let history=createOfficeHistory(model('a'));
    history=recordOfficeHistory(history,model('b'));
    history=undoOfficeHistory(history);
    history=recordOfficeHistory(history,model('x'));
    expect(canRedoOfficeHistory(history)).toBe(false);
    expect((currentOfficeHistory(history) as DocxModel).paragraphs[0]).toBe('x');
  });

  it('bounds memory by entry count',()=>{
    let history=createOfficeHistory(model('0'),3);
    history=recordOfficeHistory(history,model('1'));
    history=recordOfficeHistory(history,model('2'));
    history=recordOfficeHistory(history,model('3'));
    expect(history.entries).toHaveLength(3);
    expect((history.entries[0] as DocxModel).paragraphs[0]).toBe('1');
  });
});
