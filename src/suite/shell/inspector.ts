export const DOCUMENT_INSPECTOR_TABS = [
  'properties',
  'ai',
  'security',
  'comments',
  'sign',
] as const;

export type DocumentInspectorTab = typeof DOCUMENT_INSPECTOR_TABS[number];

export const DOCUMENT_INSPECTOR_LABELS: Record<DocumentInspectorTab,string> = {
  properties:'Properties',
  ai:'AI',
  security:'Security',
  comments:'Comments',
  sign:'Sign',
};

export const DOCUMENT_INSPECTOR_SHORTCUT = 'Ctrl/Cmd+Shift+.';

export interface InspectorShortcutLike {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  code: string;
}

export function isDocumentInspectorToggleShortcut(event: InspectorShortcutLike): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.shiftKey
    && !event.altKey
    && event.code === 'Period';
}
