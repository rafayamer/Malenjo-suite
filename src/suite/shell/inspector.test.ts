import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_INSPECTOR_SHORTCUT,
  DOCUMENT_INSPECTOR_TABS,
  isDocumentInspectorToggleShortcut,
} from './inspector';

describe('document inspector shell contract', () => {
  it('keeps the canonical compact inspector tab set', () => {
    expect(DOCUMENT_INSPECTOR_TABS).toEqual([
      'properties',
      'ai',
      'security',
      'comments',
      'sign',
    ]);
    expect(new Set(DOCUMENT_INSPECTOR_TABS).size).toBe(DOCUMENT_INSPECTOR_TABS.length);
  });

  it('uses a browser-safe explicit hide/show shortcut', () => {
    expect(DOCUMENT_INSPECTOR_SHORTCUT).toBe('Ctrl/Cmd+Shift+.');
    expect(isDocumentInspectorToggleShortcut({
      ctrlKey:true, metaKey:false, shiftKey:true, altKey:false, code:'Period',
    })).toBe(true);
    expect(isDocumentInspectorToggleShortcut({
      ctrlKey:false, metaKey:true, shiftKey:true, altKey:false, code:'Period',
    })).toBe(true);
    expect(isDocumentInspectorToggleShortcut({
      ctrlKey:true, metaKey:false, shiftKey:false, altKey:false, code:'Period',
    })).toBe(false);
    expect(isDocumentInspectorToggleShortcut({
      ctrlKey:true, metaKey:false, shiftKey:true, altKey:false, code:'KeyI',
    })).toBe(false);
  });
});
