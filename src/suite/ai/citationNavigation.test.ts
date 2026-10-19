import { describe, expect, it } from 'vitest';
import type { LibraryDocument } from '../files/types';
import type { Citation } from './rag';
import {
  citationDocumentId,
  citationNavigationLabel,
  inferCitationLocation,
  resolveCitationNavigation,
} from './citationNavigation';

const document:LibraryDocument={
  id:'doc-123',
  name:'Manual.pdf',
  extension:'pdf',
  kind:'pdf',
  sizeBytes:100,
  modifiedMs:1,
  addedMs:1,
  lastOpenedMs:1,
  available:true,
  locationLabel:'test',
};

function citation(excerpt:string):Citation{
  return {
    id:'S1',
    sourceId:'open-document-doc-123',
    sourceName:'Manual.pdf',
    chunkId:'open-document-doc-123:8',
    excerpt,
    score:1,
  };
}

describe('AI citation navigation',()=>{
  it('maps linked-source IDs back to the open document',()=>{
    expect(citationDocumentId('open-document-doc-123')).toBe('doc-123');
    expect(citationDocumentId('manual-upload-source')).toBeNull();
  });

  it('infers page/slide/row locations from extracted source text',()=>{
    expect(inferCitationLocation('Page 12\nTransformer protection')).toEqual({page:12,slide:null,row:null});
    expect(inferCitationLocation('Slide 4\nOverview')).toEqual({page:null,slide:4,row:null});
    expect(inferCitationLocation('Row 9: A\tB')).toEqual({page:null,slide:null,row:9});
  });

  it('creates a navigation target only while the source document remains open',()=>{
    const target=resolveCitationNavigation(citation('Page 12\nTransformer protection'),[document]);
    expect(target?.documentId).toBe('doc-123');
    expect(target?.page).toBe(12);
    expect(citationNavigationLabel(target!)).toBe('Manual.pdf · page 12');
    expect(resolveCitationNavigation(citation('Page 12'),[])).toBeNull();
  });
});
