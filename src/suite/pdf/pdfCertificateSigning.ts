import type {LibraryDocument} from '../files/types';

/** Pure preflight for the optional local PKCS#12 signing workflow. */
export function eligiblePdfSigningDocuments(documents:readonly LibraryDocument[]):LibraryDocument[]{
  return documents.filter(d=>d.available&&d.kind==='pdf'&&
    /\.pdf$/i.test(d.name)&&d.sizeBytes>=5&&d.sizeBytes<=32*1024*1024&&!d.ephemeral);
}
export function safePdfSigningCopyName(document:Pick<LibraryDocument,'name'>):string{
  const basename=document.name.replace(/\.pdf$/i,'');
  const safe=basename.replace(/[^A-Za-z0-9._-]/g,'_').replace(/^\.+/,'')
    .slice(0,90).replace(/\.+$/,'')||'document';
  return safe+'-signed.pdf';
}
