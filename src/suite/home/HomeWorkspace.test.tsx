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
import { HOME_PRIMARY_ACTIONS } from './model';
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
  it('renders the centered PDF-first Foxit-style start UI with accessible real file actions',()=>{
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
    expect(html).toContain('ml-start-minimal');
    expect(html).toContain('ml-start-hero');
    expect(html).toContain('Welcome to MALENJO');
    expect(html).toContain('Open a file to begin.');
    expect(html).toContain('Open File');
    expect(html).toContain('Recent Files');
    expect(html).toContain('ml-start-folder');
    expect(html).toContain('ml-start-more-tools');
    expect(html).toContain('More tools');
    expect((html.match(/class="ml-co-action-card/g)??[]).length).toBe(7);
    expect(html).toContain('Your files');
    expect(html).toContain('Search recent');
    expect(html).toContain('Filter recent files by type');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Continue working');
    expect(html).toContain('Unsaved changes');
    expect(html).not.toContain('shadcn-admin');
    expect(html).not.toContain('WPS');
    expect(html).not.toContain('Go Premium');
    expect(html).not.toContain('SALE');
    expect(html).toContain('PDF to Word');
    expect(html).toContain('PDF to Excel');
    expect(html).toContain('PDF to Slides');
    expect((html.match(/disabled=""/g)??[]).length).toBeGreaterThanOrEqual(3);
  });

  it('never advertises direct Office launching before PDF output conversion exists',()=>{
    const office=HOME_PRIMARY_ACTIONS.filter(item=>
      ['document','spreadsheet','presentation'].includes(item.id));
    expect(office).toHaveLength(3);
    expect(office.every(item=>Boolean(item.unavailableReason) &&
      !item.target && !item.opensFiles)).toBe(true);
    const open=HOME_PRIMARY_ACTIONS.find(item=>item.id==='open')!;
    expect(open.opensFiles).toBe(true);
    expect(open.unavailableReason).toBeUndefined();
  });
});
