export type AiEnterpriseRole='viewer'|'analyst'|'editor'|'admin';
export type AiDataClassification='public'|'internal'|'confidential'|'restricted';
export type AiFeaturePermission=
  |'chat'
  |'notebook'
  |'tutor'
  |'reader'
  |'memory'
  |'tool-read'
  |'tool-write'
  |'export'
  |'ocr';

export interface AiEnterprisePolicy{
  schemaVersion:1;
  offlineOnly:boolean;
  requireAudit:boolean;
  allowPersistentMemory:boolean;
  maxNotebookDocuments:number;
  maxRetentionDays:number;
  allowedClassifications:AiDataClassification[];
  rolePermissions:Record<AiEnterpriseRole,AiFeaturePermission[]>;
}

export interface AiPolicyContext{
  role:AiEnterpriseRole;
  classification:AiDataClassification;
  feature:AiFeaturePermission;
  localTransport:boolean;
  auditAvailable:boolean;
  persistentMemoryRequested:boolean;
  notebookDocumentCount:number;
}

export interface AiPolicyDecision{
  allowed:boolean;
  reason:string;
}

export const DEFAULT_AI_ENTERPRISE_POLICY:AiEnterprisePolicy={
  schemaVersion:1,
  offlineOnly:true,
  requireAudit:true,
  allowPersistentMemory:true,
  maxNotebookDocuments:50,
  maxRetentionDays:30,
  allowedClassifications:['public','internal','confidential','restricted'],
  rolePermissions:{
    viewer:['chat','notebook','tutor','reader','tool-read'],
    analyst:['chat','notebook','tutor','reader','memory','tool-read','export','ocr'],
    editor:['chat','notebook','tutor','reader','memory','tool-read','tool-write','export','ocr'],
    admin:['chat','notebook','tutor','reader','memory','tool-read','tool-write','export','ocr'],
  },
};

const roles:AiEnterpriseRole[]=['viewer','analyst','editor','admin'];
const classifications:AiDataClassification[]=['public','internal','confidential','restricted'];
const features:AiFeaturePermission[]=[
  'chat','notebook','tutor','reader','memory','tool-read','tool-write','export','ocr',
];

function unique<T>(values:T[]):T[]{
  return Array.from(new Set(values));
}

export function validateAiEnterprisePolicy(value:unknown):AiEnterprisePolicy{
  if(!value||typeof value!=='object')throw new Error('AI enterprise policy must be an object.');
  const input=value as Partial<AiEnterprisePolicy>;
  if(input.schemaVersion!==1)throw new Error('Unsupported AI enterprise policy schema.');
  if(typeof input.offlineOnly!=='boolean'||typeof input.requireAudit!=='boolean'||typeof input.allowPersistentMemory!=='boolean'){
    throw new Error('AI enterprise policy booleans are invalid.');
  }
  const maxNotebookDocuments=Math.floor(Number(input.maxNotebookDocuments));
  const maxRetentionDays=Math.floor(Number(input.maxRetentionDays));
  if(maxNotebookDocuments<1||maxNotebookDocuments>500)throw new Error('AI notebook document limit must be between 1 and 500.');
  if(maxRetentionDays<0||maxRetentionDays>3650)throw new Error('AI retention days must be between 0 and 3650.');
  if(!Array.isArray(input.allowedClassifications)||!input.allowedClassifications.length){
    throw new Error('At least one AI data classification must be allowed.');
  }
  const allowedClassifications=unique(input.allowedClassifications);
  if(allowedClassifications.some((item)=>!classifications.includes(item)))throw new Error('AI policy contains an invalid classification.');

  if(!input.rolePermissions||typeof input.rolePermissions!=='object')throw new Error('AI role permissions are required.');
  const rolePermissions={} as Record<AiEnterpriseRole,AiFeaturePermission[]>;
  for(const role of roles){
    const permissions=(input.rolePermissions as Partial<Record<AiEnterpriseRole,AiFeaturePermission[]>>)[role];
    if(!Array.isArray(permissions))throw new Error(`AI role permissions missing for ${role}.`);
    const clean=unique(permissions);
    if(clean.some((permission)=>!features.includes(permission)))throw new Error(`AI role ${role} contains an invalid permission.`);
    rolePermissions[role]=clean;
  }

  return {
    schemaVersion:1,
    offlineOnly:input.offlineOnly,
    requireAudit:input.requireAudit,
    allowPersistentMemory:input.allowPersistentMemory,
    maxNotebookDocuments,
    maxRetentionDays,
    allowedClassifications,
    rolePermissions,
  };
}

export function decideAiEnterprisePolicy(
  policy:AiEnterprisePolicy,
  context:AiPolicyContext,
):AiPolicyDecision{
  if(!policy.allowedClassifications.includes(context.classification)){
    return {allowed:false,reason:'Document classification is not approved for MALENJO AI.'};
  }
  if(policy.offlineOnly&&!context.localTransport){
    return {allowed:false,reason:'Enterprise policy requires local/offline AI transport.'};
  }
  if(policy.requireAudit&&!context.auditAvailable){
    return {allowed:false,reason:'Enterprise policy requires an available AI audit sink.'};
  }
  if(context.persistentMemoryRequested&&!policy.allowPersistentMemory){
    return {allowed:false,reason:'Enterprise policy disables persistent AI memory.'};
  }
  if(context.notebookDocumentCount>policy.maxNotebookDocuments){
    return {allowed:false,reason:'Notebook exceeds the enterprise AI document limit.'};
  }
  if(!policy.rolePermissions[context.role].includes(context.feature)){
    return {allowed:false,reason:`Role ${context.role} is not permitted to use AI feature ${context.feature}.`};
  }
  return {allowed:true,reason:'Request satisfies the enterprise AI policy.'};
}

export function canRetainAiRecord(
  policy:AiEnterprisePolicy,
  createdAtMs:number,
  nowMs=Date.now(),
):boolean{
  if(policy.maxRetentionDays===0)return false;
  const maxAge=policy.maxRetentionDays*24*60*60*1000;
  return nowMs-createdAtMs<=maxAge;
}

export function redactAiPolicyForClient(policy:AiEnterprisePolicy):Pick<
  AiEnterprisePolicy,
  'schemaVersion'|'offlineOnly'|'requireAudit'|'allowPersistentMemory'|'maxNotebookDocuments'|'maxRetentionDays'|'allowedClassifications'
>{
  return {
    schemaVersion:policy.schemaVersion,
    offlineOnly:policy.offlineOnly,
    requireAudit:policy.requireAudit,
    allowPersistentMemory:policy.allowPersistentMemory,
    maxNotebookDocuments:policy.maxNotebookDocuments,
    maxRetentionDays:policy.maxRetentionDays,
    allowedClassifications:[...policy.allowedClassifications],
  };
}
