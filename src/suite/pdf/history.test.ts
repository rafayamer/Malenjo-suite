import { describe, expect, it } from 'vitest';
import {
  canRedoPdfHistory,
  canUndoPdfHistory,
  createPdfHistory,
  currentPdfHistoryEntry,
  recordPdfHistory,
  redoPdfHistory,
  undoPdfHistory,
} from './history';

const bytes = (...values:number[]) => new Uint8Array(values);

describe('PDF history',()=>{
  it('restores clean baseline through undo and redoes the edit',()=>{
    let history=createPdfHistory(bytes(1,2,3),2);
    history=recordPdfHistory(history,bytes(4,5),3,'Delete page 2');

    expect(canUndoPdfHistory(history)).toBe(true);
    expect(currentPdfHistoryEntry(history).dirty).toBe(true);

    const undone=undoPdfHistory(history);
    expect(undone.changed).toBe(true);
    expect(Array.from(undone.entry.bytes)).toEqual([1,2,3]);
    expect(undone.entry.page).toBe(2);
    expect(undone.entry.dirty).toBe(false);
    expect(canRedoPdfHistory(undone.history)).toBe(true);

    const redone=redoPdfHistory(undone.history);
    expect(Array.from(redone.entry.bytes)).toEqual([4,5]);
    expect(redone.entry.dirty).toBe(true);
  });

  it('drops redo entries after a divergent edit',()=>{
    let history=createPdfHistory(bytes(1));
    history=recordPdfHistory(history,bytes(2),1,'A');
    history=recordPdfHistory(history,bytes(3),1,'B');
    history=undoPdfHistory(history).history;
    history=recordPdfHistory(history,bytes(9),1,'C');

    expect(canRedoPdfHistory(history)).toBe(false);
    expect(Array.from(currentPdfHistoryEntry(history).bytes)).toEqual([9]);
  });

  it('bounds entry count and memory while retaining the current state',()=>{
    let history=createPdfHistory(bytes(1,1),1,{maxEntries:3,maxBytes:6});
    history=recordPdfHistory(history,bytes(2,2),1,'A');
    history=recordPdfHistory(history,bytes(3,3),1,'B');
    history=recordPdfHistory(history,bytes(4,4),1,'C');

    expect(history.entries.length).toBeLessThanOrEqual(3);
    expect(history.totalBytes).toBeLessThanOrEqual(6);
    expect(Array.from(currentPdfHistoryEntry(history).bytes)).toEqual([4,4]);
  });

  it('retains the last thirty small edits and restores them in sequence',()=>{
    let history=createPdfHistory(bytes(0));
    for(let n=1;n<=30;n++)history=recordPdfHistory(history,bytes(n),1,'Edit '+n);
    expect(history.entries).toHaveLength(31);
    for(let n=29;n>=0;n--){
      const transition=undoPdfHistory(history);
      expect(transition.changed).toBe(true);
      history=transition.history;
      expect(Array.from(transition.entry.bytes)).toEqual([n]);
    }
    expect(canUndoPdfHistory(history)).toBe(false);
    for(let n=1;n<=30;n++){
      const transition=redoPdfHistory(history);
      expect(transition.changed).toBe(true);
      history=transition.history;
      expect(Array.from(transition.entry.bytes)).toEqual([n]);
    }
  });

  it('does not alter owned history when caller changes its input buffer',()=>{
    const input=bytes(2,3,4);
    let history=createPdfHistory(input);
    input[0]=99;
    const changed=bytes(4,5,6);
    history=recordPdfHistory(history,changed,1,'Edit');
    changed[0]=99;
    expect(undoPdfHistory(history).entry.bytes).toEqual(bytes(2,3,4));
    expect(currentPdfHistoryEntry(history).bytes).toEqual(bytes(4,5,6));
  });

  it('keeps histories independent across document tabs',()=>{
    const tabA=recordPdfHistory(createPdfHistory(bytes(1),1),bytes(2),1,'A edit');
    const tabB=createPdfHistory(bytes(9),1);
    expect(Array.from(currentPdfHistoryEntry(tabA).bytes)).toEqual([2]);
    expect(currentPdfHistoryEntry(tabA).dirty).toBe(true);
    expect(Array.from(currentPdfHistoryEntry(tabB).bytes)).toEqual([9]);
    expect(currentPdfHistoryEntry(tabB).dirty).toBe(false);
  });

  it('keeps a single oversized current entry instead of losing history state',()=>{
    let history=createPdfHistory(bytes(1),1,{maxEntries:3,maxBytes:2});
    history=recordPdfHistory(history,bytes(7,7,7,7),1,'Large edit');
    expect(history.entries).toHaveLength(2);
    expect(history.totalBytes).toBe(5);
    expect(canUndoPdfHistory(history)).toBe(true);
    expect(undoPdfHistory(history).entry.bytes).toEqual(bytes(1));
  });
});
