import { describe, expect, it } from 'vitest';
import { searchPdfIndex } from './navigation';

describe('PDF search index',()=>{
  const index=[
    {page:1,text:'MALENJO document workspace with private local tools.'},
    {page:2,text:'A contract can contain MALENJO metadata and MALENJO signatures.'},
    {page:3,text:'Nothing relevant on this page.'},
  ];

  it('finds multiple literal matches across pages in document order',()=>{
    const results=searchPdfIndex(index,'malenjo');
    expect(results.map(item=>item.page)).toEqual([1,2,2]);
    expect(results.every(item=>/malenjo/i.test(item.excerpt))).toBe(true);
  });

  it('normalizes query whitespace and is case-insensitive',()=>{
    const results=searchPdfIndex([{page:1,text:'Alpha Beta Gamma'}],'  ALPHA   BETA ');
    expect(results).toHaveLength(1);
    expect(results[0].page).toBe(1);
  });

  it('caps result volume',()=>{
    const results=searchPdfIndex([{page:1,text:'x x x x x x'}],'x',3);
    expect(results).toHaveLength(3);
  });

  it('returns no results for a blank query',()=>{
    expect(searchPdfIndex(index,'   ')).toEqual([]);
  });
});
