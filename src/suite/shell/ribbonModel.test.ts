import { describe, expect, it } from 'vitest';
import { PDF_COMMANDS } from '../commands/masterCatalog';
import { defaultRibbonTab, RIBBON_TABS, specialistRibbonActions } from './ribbonModel';

describe('MALENJO Master v2 canonical desktop ribbon', () => {
  const labels=['Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools'];
  it('has exactly ten distinct keyboard-discoverable categories, matching the catalog', () => {
    expect(RIBBON_TABS.map(tab=>tab.label)).toEqual(labels);
    expect(new Set(RIBBON_TABS.map(tab=>tab.id)).size).toBe(10);
    for(const command of PDF_COMMANDS) {
      expect(labels).toContain(command.category);
    }
  });
  it('maps every standalone workspace to a useful canonical category',()=>{
    expect(defaultRibbonTab('home')).toBe('home');
    expect(defaultRibbonTab('pdf')).toBe('home');
    expect(defaultRibbonTab('ocr')).toBe('optimize');
    expect(defaultRibbonTab('scanner')).toBe('optimize');
    expect(defaultRibbonTab('cad')).toBe('tools');
    expect(defaultRibbonTab('dicom')).toBe('tools');
    expect(defaultRibbonTab('invoice')).toBe('automate');
    expect(defaultRibbonTab('security')).toBe('protect');
  });
  it('does not expose standalone Office editors or pretend PDF conversion works',()=>{
    const convert=RIBBON_TABS.find(tab=>tab.id==='convert')!;
    expect(convert.actions).toHaveLength(3);
    expect(convert.actions.every(action=>action.unavailableReason &&
      !action.destination&&!action.opensFiles)).toBe(true);
    for(const tab of RIBBON_TABS) for(const action of tab.actions) {
      expect(Boolean(action.destination||action.opensFiles||action.unavailableReason)).toBe(true);
      expect(Boolean(action.destination&&action.opensFiles)).toBe(false);
      expect(['word','spreadsheet','presentation']).not.toContain(action.destination);
    }
  });
  it('makes unverified specialist editing actions unavailable even when a module is open',()=>{
    for(const module of ['cad','dicom','invoice','account'] as const) {
      const actions=specialistRibbonActions(module)!;
      expect(actions.filter(a=>a.unavailableReason)).toHaveLength(4);
      expect(actions.filter(a=>a.destination)).toHaveLength(2);
    }
  });
});
