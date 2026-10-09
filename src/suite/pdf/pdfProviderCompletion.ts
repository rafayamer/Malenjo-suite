import {PDFDocument} from 'pdf-lib';
import type {PdfProviderResponse} from './backend';
import type {PdfProviderResultAction} from './providerResultGuard';
import {verifyPdfBatchZip} from './pdfTwentyWorkflows';

const GENERIC_ZIP_SPLIT_ROUTES=new Set([
  '/api/v1/general/split-pages',
  '/api/v1/general/split-by-size-or-count',
]);

/** Shared acceptance for provider routes outside the 20-workflow manifest.
 * Protects direct uploads when the workspace is empty, as well as both
 * legacy split endpoints. Never report a save for unparsed provider bytes.
 */
export async function verifyProviderCompletion(
  path:string,action:PdfProviderResultAction,response:PdfProviderResponse,
  hasActiveSource:boolean,
):Promise<void>{
  if(GENERIC_ZIP_SPLIT_ROUTES.has(path)){
    if(action!=='save-file')throw new Error('The split endpoint did not return the required ZIP export.');
    await verifyPdfBatchZip(response.bytes,'pdf');
  }
  if(action==='apply-pdf'&&!hasActiveSource){
    try{
      const parsed=await PDFDocument.load(Uint8Array.from(response.bytes),{
        ignoreEncryption:false,updateMetadata:false,
      });
      if(parsed.getPageCount()<1)throw new Error('No pages');
    }catch{
      throw new Error('PDF output could not be reopened for an empty workspace; nothing was saved.');
    }
  }
}
