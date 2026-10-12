import { describe, expect, it } from 'vitest';
import { defaultRibbonTab, RIBBON_TABS } from './ribbonModel';

describe('Single-window MALENJO ribbon contracts', () => {
  it('offers a unique set of keyboard-discoverable ribbon tabs', () => {
    expect(new Set(RIBBON_TABS.map((tab) => tab.id)).size).toBe(RIBBON_TABS.length);
    expect(RIBBON_TABS.map((tab) => tab.label)).toContain('Home');
    expect(RIBBON_TABS.map((tab) => tab.label)).toContain('PDF Viewer');
    expect(RIBBON_TABS.map((tab) => tab.label)).toContain('CAD & DICOM');
  });
  it('routes specialist/scan workspaces into appropriate tabs', () => {
    expect(defaultRibbonTab('dicom')).toBe('specialist');
    expect(defaultRibbonTab('cad')).toBe('specialist');
    expect(defaultRibbonTab('pdf')).toBe('pdf');
    expect(defaultRibbonTab('home')).toBe('home');
    expect(defaultRibbonTab('ocr')).toBe('scan');
  });
  it('never presents unverified PDF-to-Office conversions as executable commands', () => {
    const convert = RIBBON_TABS.find((tab) => tab.id === 'convert')!;
    expect(convert.actions).toHaveLength(3);
    expect(convert.actions.every((action) =>
      Boolean(action.unavailableReason) && !action.destination && !action.opensFiles)).toBe(true);
  });
  it('all enabled ribbon actions navigate in the same suite window or open a picker', () => {
    for (const tab of RIBBON_TABS) for (const action of tab.actions) {
      expect(Boolean(action.destination || action.opensFiles || action.unavailableReason)).toBe(true);
      expect(Boolean(action.destination && action.opensFiles)).toBe(false);
    }
  });
});
