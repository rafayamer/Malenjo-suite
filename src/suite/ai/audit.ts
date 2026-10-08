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
  const scanLimit=Math.max(max+32,max*4);
  const bounded=value.slice(0,scanLimit);
  const clean=bounded.replace(/[\u0000-\u001F\u007F-\u009F]/g,' ').trim().slice(0,max);
  return clean||null;
}

function boundedInt(value:number,max:number):number{
  if(!Number.isFinite(value))return 0;
  return Math.max(0,Math.min(Math.floor(value),max));
}

function boundedWarnings(values:string[]|undefined):string[]{
  const warnings:string[]=[];
  const input=values??[];
  const scanLimit=Math.min(input.length,100);
  for(let index=0;index<scanLimit&&warnings.length<20;index+=1){
    const clean=cleanLabel(input[index],160);
    if(clean)warnings.push(clean);
  }
  return warnings;
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
    policyWarnings:boundedWarnings(input.policyWarnings),
    errorCode:cleanLabel(input.errorCode,80),
  };
}

function snapshotAiAuditRecord(record:AiAuditRecord):AiAuditRecord{
  return createAiAuditRecord({
    timestampMs:record.timestampMs,
    feature:record.feature,
    provider:record.provider,
    model:record.model,
    modelProfileId:record.modelProfileId,
    promptPolicyId:record.promptPolicyId,
    status:record.status,
    latencyMs:record.latencyMs,
    sourceCount:record.sourceCount,
    citationCount:record.citationCount,
    inputChars:record.inputChars,
    outputChars:record.outputChars,
    policyWarnings:record.policyWarnings,
    errorCode:record.errorCode,
  });
}

export function appendAiAuditRecord(records:AiAuditRecord[],record:AiAuditRecord):AiAuditRecord[]{
  const retained=records.slice(-(MAX_LOG_RECORDS-1)).map(snapshotAiAuditRecord);
  return [...retained,snapshotAiAuditRecord(record)];
}

export function serializeAiAuditLog(records:AiAuditRecord[]):string{
  return records
    .slice(-MAX_LOG_RECORDS)
    .map(snapshotAiAuditRecord)
    .map((record)=>JSON.stringify(record))
    .join('\n');
}
