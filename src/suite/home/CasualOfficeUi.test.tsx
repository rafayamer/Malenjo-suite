import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfficeSegmentedFilter } from './CasualOfficeUi';

const options = [
  { value:'all',label:'All' },
  { value:'pdf',label:'PDF' },
  { value:'documents',label:'Documents' },
];

describe('Home document-type filter keyboard contract', () => {
  it('has exactly one keyboard tab stop for the currently selected filter', () => {
    for(const value of ['all','pdf','documents'] as const) {
      const html=renderToStaticMarkup(
        <OfficeSegmentedFilter options={options} value={value} onChange={()=>undefined}
          aria-label="Filter recent files by type" />
      );
      expect(html).toContain('role="tablist"');
      expect(html).toContain('Filter recent files by type');
      expect((html.match(/role="tab"/g)||[])).toHaveLength(3);
      expect((html.match(/aria-selected="true"/g)||[])).toHaveLength(1);
      expect((html.match(/tabindex="0"/g)||[])).toHaveLength(1);
      expect((html.match(/tabindex="-1"/g)||[])).toHaveLength(2);
    }
  });
});
