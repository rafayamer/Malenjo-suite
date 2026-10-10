import {describe,expect,it} from 'vitest';
import {createPdfLocalDeveloperGuide,type PdfLocalDeveloperGuide} from './pdfDeveloperGuides';
describe('local PDF documentation',()=>{
 it('exports actual bounded UTF-8 Markdown guides',()=>{
   for(const kind of ['folder-scanning','sso','airgapped'] as PdfLocalDeveloperGuide[]){
     const result=createPdfLocalDeveloperGuide(kind);
     expect(result.filename).toContain(kind);
     expect(result.bytes.length).toBeGreaterThan(450);
     expect(new TextDecoder('utf-8',{fatal:true}).decode(result.bytes)).toMatch(/^# MALENJO PDF/);
   }
 });
 it('does not fake folder-watching, SSO or CBR',()=>{
   const read=(kind:PdfLocalDeveloperGuide)=>new TextDecoder().decode(createPdfLocalDeveloperGuide(kind).bytes);
   expect(read('folder-scanning')).toContain('NO persistent watched-folder');
   expect(read('sso')).toContain('NOT operate as an SAML/OIDC');
   expect(read('airgapped')).toContain('DIFFERENT');
   expect(read('airgapped')).toContain('RFC 3161');
 });
 it('rejects unrecognized arbitrary guide keys',()=>{
   expect(()=>createPdfLocalDeveloperGuide('private' as PdfLocalDeveloperGuide)).toThrow(/Unknown/);
 });
});
