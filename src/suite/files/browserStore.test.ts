import { describe, expect, it } from 'vitest';
import {
  listBrowserDocuments,
  markBrowserDocumentOpened,
  registerBrowserFiles,
  removeBrowserDocument,
} from './browserStore';

function fakeFile(name:string,size:number,lastModified:number):File {
  return { name, size, lastModified } as File;
}

describe('Codespaces/browser multi-file opener',()=>{
  it('registers each selected file as an independent document for its own tab',()=>{
    const [pdf,docx,xlsx]=registerBrowserFiles([
      fakeFile('A.pdf',10,1),
      fakeFile('B.docx',20,2),
      fakeFile('C.xlsx',30,3),
    ]);

    expect(new Set([pdf.id,docx.id,xlsx.id]).size).toBe(3);
    expect([pdf.kind,docx.kind,xlsx.kind]).toEqual(['pdf','docx','xlsx']);
    expect(pdf.browserFile?.name).toBe('A.pdf');
    expect(docx.ephemeral).toBe(true);

    [pdf,docx,xlsx].forEach(removeBrowserDocument);
  });

  it('tracks open time without replacing the browser document identity',()=>{
    const [document]=registerBrowserFiles([fakeFile('Tab.pdf',42,5)]);
    const opened=markBrowserDocumentOpened(document);
    expect(opened.id).toBe(document.id);
    expect(opened.lastOpenedMs).not.toBeNull();
    expect(listBrowserDocuments().some((item)=>item.id===document.id)).toBe(true);
    removeBrowserDocument(document);
  });
});
