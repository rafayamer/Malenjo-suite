import { describe, expect, it } from 'vitest';
import { PDF_MASTER_TABS, masterTabForCategory, masterPdfTabFromShortcut, moveMasterPdfTab } from './masterRibbonTabs';
import { PDF_COMMANDS, LEGACY_TOOL_REQUIREMENTS } from '../commands/masterCatalog';

describe('Master v2 PDF-first ribbon contract', () => {
  const exact = ['Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools'];
  it('shows exactly ten canonical tabs with unique shortcuts', () => {
    expect(PDF_MASTER_TABS.map(tab=>tab.label)).toEqual(exact);
    expect(new Set(PDF_MASTER_TABS.map(tab=>tab.id)).size).toBe(10);
    expect(new Set(PDF_MASTER_TABS.map(tab=>tab.shortcut)).size).toBe(10);
  });
  it('maps all historical PDF engine categories without deleting real handlers', () => {
    for(const tab of PDF_MASTER_TABS)expect(masterTabForCategory(tab.category)).toBe(tab.id);
    expect(masterTabForCategory('sign')).toBe('protect');
    expect(masterTabForCategory('comment')).toBe('review');
    expect(masterTabForCategory('scan')).toBe('optimize');
    expect(masterTabForCategory('ai')).toBe('tools');
  });
  it('provides predictable keyboard wrap and ten master shortcuts', () => {
    expect(moveMasterPdfTab('home','ArrowLeft')).toBe('tools');
    expect(moveMasterPdfTab('tools','ArrowRight')).toBe('home');
    expect(moveMasterPdfTab('review','Home')).toBe('home');
    expect(moveMasterPdfTab('review','End')).toBe('tools');
    for(const [index,tab] of PDF_MASTER_TABS.entries()){
      const digit=index===9?'0':String(index+1);
      expect(masterPdfTabFromShortcut({
        altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit'+digit,
      })).toBe(tab.id);
    }
    expect(masterPdfTabFromShortcut({
      altKey:false,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit1',
    })).toBeNull();
  });
  it('keeps all 90 unique MAL identifiers and all 15 legacy tool mappings', () => {
    expect(PDF_COMMANDS).toHaveLength(90);
    expect(new Set(PDF_COMMANDS.map(command=>command.id)).size).toBe(90);
    expect(PDF_COMMANDS.map(command=>command.id)).toEqual(
      Array.from({length:90},(_,index)=>'MAL-'+String(index+1).padStart(3,'0')),
    );
    expect(LEGACY_TOOL_REQUIREMENTS).toHaveLength(15);
    for(const command of PDF_COMMANDS){
      expect(exact).toContain(command.category);
      expect(command.status).toBe('NOT_RELEASE_READY');
      expect(command.isAvailable({permissions:[]})).toBe(false);
      expect(command.tooltip.length).toBeGreaterThan(20);
    }
  });
});
