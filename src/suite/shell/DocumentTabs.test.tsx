import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DocumentSession } from '../files/session';
import DocumentTabs from './DocumentTabs';

function session(id: string, name: string, dirty: boolean): DocumentSession {
  return {
    id,
    document: {
      id, name, extension:'pdf', kind:'pdf', sizeBytes:100, modifiedMs:1,
      addedMs:1, lastOpenedMs:1, available:true, locationLabel:'Test',
    },
    dirty, saving:false, openedAt:1, lastSavedAt:null,
  };
}
const options = {
  onActivate: () => undefined,
  onClose: () => undefined,
  onCloseOthers: () => undefined,
  onCloseRight: () => undefined,
  onCloseAll: () => undefined,
  onReorder: () => undefined,
};

describe('single-window document tabs keyboard/accessibility contract', () => {
  it('exposes one reachable selected document tab and dirty-state semantics', () => {
    const html = renderToStaticMarkup(<DocumentTabs
      sessions={[session('a','Budget.pdf',true),session('b','Report.pdf',false)]}
      activeSessionId="a"
      {...options}
    />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Open documents"');
    expect(html).toContain('aria-label="Budget.pdf — unsaved changes"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect((html.match(/tabindex="0"/g)??[]).length).toBe(1);
    expect((html.match(/tabindex="-1"/g)??[]).length).toBe(1);
  });
  it('keeps document tabs keyboard reachable while Home is active', () => {
    const html = renderToStaticMarkup(<DocumentTabs
      sessions={[session('a','Budget.pdf',false),session('b','Report.pdf',false)]}
      activeSessionId={null}
      {...options}
    />);
    expect((html.match(/tabindex="0"/g)??[]).length).toBe(1);
    expect(html).toContain('aria-haspopup="menu"');
  });
});
