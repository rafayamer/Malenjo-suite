import { describe,expect,it } from 'vitest';
import { nextPdfViewPage,pdfViewPages } from './viewMode';

describe('PDF view modes',()=>{
  it('renders all pages in continuous mode',()=>{
    expect(pdfViewPages('continuous',2,4)).toEqual([1,2,3,4]);
  });
  it('renders only the current page in single mode',()=>{
    expect(pdfViewPages('single',3,5)).toEqual([3]);
  });
  it('renders facing page pairs in two-page mode',()=>{
    expect(pdfViewPages('two',1,5)).toEqual([1,2]);
    expect(pdfViewPages('two',2,5)).toEqual([1,2]);
    expect(pdfViewPages('two',4,5)).toEqual([3,4]);
    expect(pdfViewPages('two',5,5)).toEqual([5]);
  });
  it('steps by spreads in two-page mode and clamps bounds',()=>{
    expect(nextPdfViewPage('two',1,10,1)).toBe(3);
    expect(nextPdfViewPage('two',9,10,1)).toBe(10);
    expect(nextPdfViewPage('single',1,10,-1)).toBe(1);
  });
});
