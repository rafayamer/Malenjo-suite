import { describe, expect, it } from 'vitest';
import { defaultRibbonTab, RIBBON_TABS } from './ribbonModel';

describe('Single-window MALENJO ribbon contracts', () => {
  it('offers a unique set of keyboard-discoverable ribbon tabs', () => {
    expect(new Set(RIBBON_TABS.map((tab) => tab.id)).size).toBe(RIBBON_TABS.length);
    expect(RIBBON_TABS.map((tab) => tab.label)).toContain('Home');
    expect(RIBBON_TABS.map((tab) => tab.label)).toEqual([
      'Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools',
    ]);
  });
  it('routes specialist/scan workspaces into appropriate tabs', () => {
    expect(defaultRibbonTab('dicom')).toBe('tools');
    expect(defaultRibbonTab('cad')).toBe('tools');
    expect(defaultRibbonTab('pdf')).toBe('home');
    expect(defaultRibbonTab('home')).toBe('home');
    expect(defaultRibbonTab('ocr')).toBe('optimize');
  });
  it('never presents unverified PDF-to-Office conversions as executable commands', () => {
    const convert = RIBBON_TABS.find((tab) => tab.id === 'convert')!;
    for(const id of ['MAL-037','MAL-038','MAL-039']){
      const action=convert.actions.find(action=>action.id===id);
      expect(action?.unavailableReason).toContain(id);
      expect(action?.destination).toBeUndefined();
      expect(action?.opensFiles).toBeUndefined();
    }
    expect(convert.actions.some(action=>action.destination==='pdf')).toBe(true);
  });
  it('all enabled ribbon actions navigate in the same suite window or open a picker', () => {
    for (const tab of RIBBON_TABS) for (const action of tab.actions) {
      expect(Boolean(action.destination || action.opensFiles || action.unavailableReason)).toBe(true);
      expect(Boolean(action.destination && action.opensFiles)).toBe(false);
    }
  });
});
