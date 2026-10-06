/**
 * MALENJO-owned, versioned PDF provider contract.
 *
 * Rendering stays behind MALENJO/PDF.js. Mutation/conversion/analysis providers
 * are injected through this contract so the workspace does not depend on a
 * third-party API schema or process implementation.
 */
export const PDF_PROVIDER_CONTRACT_VERSION=1 as const;

export type PdfProviderToolCategory=
  |'home'|'edit'|'convert'|'organize'|'comment'|'sign'|'protect'|'forms'|'scan'|'automate';

export type PdfProviderFieldKind='string'|'boolean'|'number'|'integer'|'file'|'files'|'json';

export interface PdfProviderOperationField{
  name:string;
  label:string;
  kind:PdfProviderFieldKind;
  required:boolean;
  description?:string;
  enumValues?:string[];
  defaultValue?:string|number|boolean;
  location:'query'|'form';
}

export interface PdfProviderOperation{
  id:string;
  path:string;
  method:'GET'|'POST';
  summary:string;
  description:string;
  tags:string[];
  fields:PdfProviderOperationField[];
  category:PdfProviderToolCategory;
}

export interface PdfProviderInputFile{
  field:string;
  filename:string;
  contentType?:string;
  bytes:number[];
}

export interface PdfProviderResponse{
  status:number;
  contentType?:string|null;
  contentDisposition?:string|null;
  bytes:number[];
}

export interface PdfProviderComponentStatus{
  id:string;
  ready:boolean;
  version?:string|null;
  source:string;
  detail:string;
}

export interface PdfProviderStatus{
  installed:boolean;
  running:boolean;
  runtime?:string|null;
  packagePath?:string|null;
  endpoint:string;
  version?:string|null;
  message:string;
  components:PdfProviderComponentStatus[];
}

export interface PdfToolProvider{
  readonly id:string;
  readonly contractVersion:typeof PDF_PROVIDER_CONTRACT_VERSION;
  readonly execution:'local-sidecar'|'in-process';
  readonly autostart:false;
  readonly reviewedToolCount:number;
  status():Promise<PdfProviderStatus>;
  start():Promise<PdfProviderStatus>;
  stop():Promise<boolean>;
  listOperations():Promise<PdfProviderOperation[]>;
  run(
    operation:Pick<PdfProviderOperation,'path'|'method'>,
    fields:Array<{name:string;value:string}>,
    files:PdfProviderInputFile[],
  ):Promise<PdfProviderResponse>;
  responseIsPdf(response:PdfProviderResponse):boolean;
  saveResponse(response:PdfProviderResponse,fallbackBaseName?:string):Promise<string|null>;
}

export interface PdfBackendCapabilities {
  merge:boolean;
  split:boolean;
  rotatePages:boolean;
  reorderPages:boolean;
  redact:boolean;
  watermark:boolean;
  encrypt:boolean;
  optimize:boolean;
}

export interface PdfBackend {
  readonly id:string;
  readonly capabilities:PdfBackendCapabilities;
}

export const viewerOnlyPdfBackend:PdfBackend={
  id:'malenjo.viewer-only',
  capabilities:{
    merge:false,
    split:false,
    rotatePages:false,
    reorderPages:false,
    redact:false,
    watermark:false,
    encrypt:false,
    optimize:false,
  },
};
