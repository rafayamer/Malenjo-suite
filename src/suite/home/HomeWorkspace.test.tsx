import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core',()=>({
  isTauri:()=>false,
  invoke:vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog',()=>({
  open:vi.fn(),
  save:vi.fn(),
  confirm:vi.fn(),
}));

import HomeWorkspace from './HomeWorkspace';
import type { DocumentSession } from '../files/session';

const session:DocumentSession={
  id:'session-1',
  document:{
    id:'doc-1',
    name:'Contract.pdf',
    extension:'pdf',
    kind:'pdf',
    sizeBytes:10,
    modifiedMs:1,
    addedMs:1,
    lastOpenedMs:1,
    available:true,
    locationLabel:'Browser session',
  },
  dirty:true,
  saving:false,
  openedAt:100,
  lastSavedAt:null,
};

describe('Home CasualOffice structural/accessibility baseline',()=>{
  it('renders the source-adapted office launcher rather than the old generic dashboard',()=>{
    const html=renderToStaticMarkup(
      <HomeWorkspace
        sessions={[session]}
        activeSessionId={null}
        onSelectModule={()=>undefined}
        onActivateSession={()=>undefined}
        onOpenDocument={()=>undefined}
        onOpenDocuments={()=>undefined}
        onOpenCommandPalette={()=>undefined}
      />,
    );

    expect((html.match(/ml-co-action-card/g)??[]).length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('Welcome to Malenjo Suite');
    expect(html).toContain('Open something, or start a local document task.');
    expect(html).toContain('Your files');
    expect(html).toContain('Search recent');
    expect(html).toContain('Filter recent files by type');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Continue working');
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('Pinned locations');
    expect(html).toContain('updater not operational yet');
    expect(html).toContain('Not connected');
    expect(html).toContain('Ctrl');
    expect(html).toContain('Search');
    expect(html).not.toContain('shadcn-admin');
    expect(html).not.toContain('WPS');
    expect(html).not.toContain('Go Premium');
    expect(html).not.toContain('SALE');
  });
});
