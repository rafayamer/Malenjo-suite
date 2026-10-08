import { describe, expect, it } from 'vitest';
import type { LibraryDocument } from '../files/types';
import { extractOpenDocumentSource, isOpenDocumentAiSource } from './sources';

function browserDocument(name:string,text:string):LibraryDocument{
  const bytes=new TextEncoder().encode(text);
  const file={
    name,
    size:bytes.byteLength,
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
  } as File;
  return {
    id:'doc-browser-1',
    name,
    extension:name.split('.').pop()??'',
    kind:name.endsWith('.pdf')?'pdf':'other',
    sizeBytes:bytes.byteLength,
    modifiedMs:10,
    addedMs:10,
    lastOpenedMs:10,
    available:true,
    locationLabel:'Codespaces session',
    browserFile:file,
    ephemeral:true,
  };
}

describe('open documents as AI sources',()=>{
  it('recognizes indexable browser documents',()=>{
    expect(isOpenDocumentAiSource(browserDocument('notes.txt','hello'))).toBe(true);
    const image={...browserDocument('image.png','abc'),kind:'image' as const,extension:'png'};
    expect(isOpenDocumentAiSource(image)).toBe(false);
  });

  it('extracts a stable source identity from an open browser document',async()=>{
    const document=browserDocument('notes.txt','Transformer testing interval is twelve months.');
    const first=await extractOpenDocumentSource(document);
    const second=await extractOpenDocumentSource(document);
    expect(first.id).toBe('open-document-doc-browser-1');
    expect(second.id).toBe(first.id);
    expect(first.name).toBe('notes.txt');
    expect(first.text).toContain('Transformer testing interval');
  });

  it('rejects oversized native documents before any native byte read',async()=>{
    const oversized:LibraryDocument={
      id:'native-large',
      name:'large.pdf',
      extension:'pdf',
      kind:'pdf',
      sizeBytes:101*1024*1024,
      modifiedMs:1,
      addedMs:1,
      lastOpenedMs:1,
      available:true,
      locationLabel:'Desktop library',
    };
    await expect(extractOpenDocumentSource(oversized)).rejects.toThrow(/between 1 byte and 100 MB/);
  });

  it('does not claim unsupported native document kinds are indexable',()=>{
    const native:LibraryDocument={
      id:'native-image',
      name:'photo.png',
      extension:'png',
      kind:'image',
      sizeBytes:100,
      modifiedMs:1,
      addedMs:1,
      lastOpenedMs:1,
      available:true,
      locationLabel:'Desktop library',
    };
    expect(isOpenDocumentAiSource(native)).toBe(false);
  });
});
