import {describe,expect,it} from 'vitest';
import {extractPdfPageSearchText,findPdfTextMatches} from './pdfTextHighlights';

describe('PDF selectable text and search helpers',()=>{
  it('finds multiple case-insensitive matches at exact offsets',()=>{
    expect(findPdfTextMatches('MalEnJo Suite — MALENJO tools','malenjo'))
      .toEqual([{start:0,end:7},{start:16,end:23}]);
  });
  it('handles malicious literal text without interpreting scripts',()=>{
    expect(findPdfTextMatches('<script>alert(1)</script>','<script>'))
      .toEqual([{start:0,end:8}]);
  });
  it('limits match count and ignores empty searches',()=>{
    expect(findPdfTextMatches('a a a a a','a',2)).toHaveLength(2);
    expect(findPdfTextMatches('hello','   ')).toEqual([]);
  });
  it('joins PDF.js text fragments and line endings for page Find',()=>{
    expect(extractPdfPageSearchText([
      {str:'MALENJO'},{str:'Suite',hasEOL:true},{str:'Search'},{str:'Works'},
    ])).toBe('MALENJO Suite Search Works');
  });
});
