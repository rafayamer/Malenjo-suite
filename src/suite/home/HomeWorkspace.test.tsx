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

describe('Home visual/accessibility baseline',()=>{
  it('renders the OSS-derived start-center major states without proprietary WPS UI',()=>{
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

    expect((html.match(/home-launch-tile/g)??[])).toHaveLength(8);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Home document views"');
    expect(html).toContain('Recent');
    expect(html).toContain('Starred');
    expect(html).toContain('Locations');
    expect(html).toContain('Continue working');
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('Ready for local work');
    expect(html).toContain('The updater module is not operational yet');
    expect(html).toContain('No classroom account provider is connected');
    expect(html).toContain('Search everything');
    expect(html).not.toContain('WPS');
    expect(html).not.toContain('Go Premium');
    expect(html).not.toContain('SALE');
  });
});
