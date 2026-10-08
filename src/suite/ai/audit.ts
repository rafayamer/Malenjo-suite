export type AiAuditStatus='success'|'cancelled'|'blocked'|'error';
export type AiAuditFeature='document-chat'|'summarize'|'extract'|'classify'|'rewrite';

export interface AiAuditRecord{
  schemaVersion:1;
  timestampMs:number;
  feature:AiAuditFeature;
  provider:'ollama'|'llama-cpp'|'none';
  model:string|null;
  modelProfileId:string|null;
  promptPolicyId:string;
  status:AiAuditStatus;
  latencyMs:number|null;
  sourceCount:number;
  citationCount:number;
  inputChars:number;
  outputChars:number;
  policyWarnings:string[];
  errorCode:string|null;
}

export interface AiAuditInput extends Omit<AiAuditRecord,'schemaVersion'|'timestampMs'|'model'|'modelProfileId'|'promptPolicyId'|'policyWarnings'|'errorCode'>{
  timestampMs?:number;
  model?:string|null;
  modelProfileId?:string|null;
  promptPolicyId:string;
  policyWarnings?:string[];
  errorCode?:string|null;
}

const MAX_LOG_RECORDS=500;

function cleanLabel(value:string|null|undefined,max=160):string|null{
  if(!value)return null;
  const clean=value.replace(/[\u0000-\u001F\u007F-\u009F]/g,' ').trim().slice(0,max);
  return clean||null;
}

function boundedInt(value:number,max:number):number{
  if(!Number.isFinite(value))return 0;
  return Math.max(0,Math.min(Math.floor(value),max));
}

export function createAiAuditRecord(input:AiAuditInput):AiAuditRecord{
  return {
    schemaVersion:1,
    timestampMs:boundedInt(input.timestampMs??Date.now(),Number.MAX_SAFE_INTEGER),
    feature:input.feature,
    provider:input.provider,
    model:cleanLabel(input.model),
    modelProfileId:cleanLabel(input.modelProfileId),
    promptPolicyId:cleanLabel(input.promptPolicyId,120)??'unknown',
    status:input.status,
    latencyMs:input.latencyMs===null?null:boundedInt(input.latencyMs??0,86_400_000),
    sourceCount:boundedInt(input.sourceCount,10_000),
    citationCount:boundedInt(input.citationCount,10_000),
    inputChars:boundedInt(input.inputChars,100_000_000),
    outputChars:boundedInt(input.outputChars,100_000_000),
    policyWarnings:(input.policyWarnings??[])
      .map((item)=>cleanLabel(item,160))
      .filter((item):item is string=>!!item)
      .slice(0,20),
    errorCode:cleanLabel(input.errorCode,80),
  };
}

export function appendAiAuditRecord(records:AiAuditRecord[],record:AiAuditRecord):AiAuditRecord[]{
  return [...records,record].slice(-MAX_LOG_RECORDS);
}

export function serializeAiAuditLog(records:AiAuditRecord[]):string{
  return records.slice(-MAX_LOG_RECORDS).map((record)=>JSON.stringify(record)).join('\n');
}
