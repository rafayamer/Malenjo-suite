import { describe, expect, it } from 'vitest';
import {
  PDF_MASTER_RIBBON_TABS, masterRibbonTabForTask, moveMasterRibbonTab,
  taskForMasterRibbonTab,
} from './taskToolbar';
import { PDF_COMMANDS } from '../commands/masterCatalog';

describe('Master Specification v2.0: PDF-first ten-category ribbon', () => {
  it('uses exactly ten primary tabs in the specified order', () => {
    expect(PDF_MASTER_RIBBON_TABS.map(({label})=>label)).toEqual([
      'Home','Edit','Organize','Optimize','Convert',
      'Forms','Review','Protect','Automate','Tools',
    ]);
    expect(new Set(PDF_MASTER_RIBBON_TABS.map(tab=>tab.id)).size).toBe(10);
    expect(PDF_MASTER_RIBBON_TABS.every(tab=>Boolean(tab.task))).toBe(true);
  });

  it('retains legacy handlers under their new accessible category', () => {
    expect(taskForMasterRibbonTab('review')).toBe('comment');
    expect(masterRibbonTabForTask('sign')).toBe('review');
    expect(taskForMasterRibbonTab('optimize')).toBe('scan');
    expect(taskForMasterRibbonTab('convert')).toBe('convert');
    expect(masterRibbonTabForTask('home')).toBe('home');
  });

  it('supports roving left/right/home/end focus without unsupported hidden tabs', () => {
    expect(moveMasterRibbonTab('home','ArrowLeft')).toBe('tools');
    expect(moveMasterRibbonTab('tools','ArrowRight')).toBe('home');
    expect(moveMasterRibbonTab('convert','Home')).toBe('home');
    expect(moveMasterRibbonTab('review','End')).toBe('tools');
  });

  it('covers every non-Home ribbon category with the master 90 commands', () => {
    expect(PDF_COMMANDS).toHaveLength(90);
    const groups=new Set(PDF_COMMANDS.map(command=>command.category));
    expect([...groups].sort()).toEqual(PDF_MASTER_RIBBON_TABS.map(tab=>tab.label)
      .filter(name=>name!=='Home').sort());
  });
});
