import {PDF_PROVIDER_CONTRACT_VERSION,
  type PdfProviderComponentStatus,
  type PdfProviderOperation,
  type PdfProviderStatus,
} from './backend';

/** Offline runtime API diagnostic export. This documents what the local API
 * actually reports; it is not an assertion that a route works or is certified.
 * Password values, uploaded files, absolute executable paths and raw OpenAPI
 * implementation internals are deliberately excluded.
 */
export const PDF_API_MANUAL_MAX_OPERATIONS=1500;
export const PDF_API_MANUAL_MAX_BYTES=4*1024*1024;
export function buildLocalPdfApiManual(
  operations:readonly PdfProviderOperation[],
  components:readonly PdfProviderComponentStatus[],
  status:PdfProviderStatus,
):Uint8Array{
  if(operations.length>PDF_API_MANUAL_MAX_OPERATIONS||components.length>100){
    throw new Error('Local PDF API catalog exceeds the safe diagnostics limit.');
  }
  const seen=new Set<string>();
  const catalog=operations.map(op=>{
    if(op.path.length>1000||op.id.length>300||op.fields.length>100||
       !op.path.startsWith('/')||!['GET','POST'].includes(op.method)){
      throw new Error('Local PDF API includes an invalid or oversized operation.');
    }
    const key=op.method+' '+op.path;
    if(seen.has(key)){
      throw new Error('Local PDF API catalog includes duplicate method/path routes.');
    }
    seen.add(key);
    return {
      id:op.id,method:op.method,path:op.path,
      summary:op.summary.slice(0,500),
      category:op.category,
      reportedAvailable:op.capability.available,
      implementation:op.capability.implementation.slice(0,500),
      componentPack:op.capability.componentPack??null,
      legalReference:op.capability.legalReference.slice(0,500),
      fields:op.fields.map(field=>({
        name:field.name.slice(0,128),kind:field.kind,
        required:field.required,location:field.location,
        accepts:field.kind==='file'||field.kind==='files'?field.accept??null:null,
        // No form-field values or sensitive defaults.
      })),
    };
  });
  const result={
    schemaVersion:1,
    inspection:'local-provider-contract-diagnostics',
    malenjoProviderContractVersion:PDF_PROVIDER_CONTRACT_VERSION,
    reportedRunning:status.running,
    reportedInstalled:status.installed,
    operationCount:catalog.length,
    reportedEnabled:catalog.filter(op=>op.reportedAvailable).length,
    components:components.map(component=>({
      id:component.id.slice(0,128),
      reportedAvailable:component.available,
      version:component.version??null,
      source:component.source,
    })),
    operations:catalog,
    warning:'Live route and capability listings are runtime diagnostics, not evidence of verified execution, legal redistribution, or complete PDF feature acceptance.',
  };
  const bytes=new TextEncoder().encode(JSON.stringify(result,null,2)+'\n');
  if(bytes.length>PDF_API_MANUAL_MAX_BYTES){
    throw new Error('Local PDF API diagnostics exceed the 4 MB output limit.');
  }
  return bytes;
}
