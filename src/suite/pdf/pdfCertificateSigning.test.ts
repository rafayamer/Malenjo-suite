import {describe,expect,it} from 'vitest';
import {eligiblePdfSigningDocuments,safePdfSigningCopyName} from './pdfCertificateSigning';
import type {LibraryDocument} from '../files/types';

function doc(name:string,changes:Partial<LibraryDocument>={}):LibraryDocument{
  return {
    id:'id-'+name,name,kind:'pdf',extension:'pdf',sizeBytes:100,
    available:true,modifiedMs:0,addedMs:0,lastOpenedMs:null,locationLabel:'Local',
    ...changes,
  };
}
describe('PKCS#12 signing workflow preflight',()=>{
  it('only exposes available non-ephemeral real local PDFs under 32 MB',()=>{
    const files=[
      doc('report.pdf'),doc('REPORT.PDF'),
      doc('notes.txt'),doc('not-found.pdf',{available:false}),
      doc('empty.pdf',{sizeBytes:0}),
      doc('large.pdf',{sizeBytes:32*1024*1024+1}),
      doc('browser.pdf',{ephemeral:true}),
      doc('wrongkind.pdf',{kind:'image'}),
    ];
    expect(eligiblePdfSigningDocuments(files).map(x=>x.name))
      .toEqual(['report.pdf','REPORT.PDF']);
  });
  it('creates safe explicitly distinct PDF copy filenames',()=>{
    expect(safePdfSigningCopyName(doc('../a\\secret.pdf'))).toBe('a_secret-signed.pdf');
    expect(safePdfSigningCopyName(doc('report.pdf'))).toBe('report-signed.pdf');
    expect(safePdfSigningCopyName(doc('...pdf'))).toBe('document-signed.pdf');
  });
});
