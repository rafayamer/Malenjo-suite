export interface DmsVersion {
  id:string;
  createdMs:number;
  sha256:string;
  sizeBytes:number;
  note:string;
  snapshotRelPath:string;
}
export interface DmsRecord {
  id:string;
  documentId:string;
  name:string;
  tags:string[];
  retentionDays:number;
  legalHold:boolean;
  createdMs:number;
  updatedMs:number;
  versions:DmsVersion[];
}
export interface RetentionCandidate {
  recordId:string;
  versionId:string;
  recordName:string;
  createdMs:number;
  reason:string;
}
export interface EnterprisePolicy {
  version:number;
  currentRole:string;
  defaultRetentionDays:number;
  auditRetentionDays:number;
}
export interface RoleProfile { role:string; permissions:string[]; }
export interface WorkflowStep { kind:'audit'|'dms_snapshot'; recordId?:string; note?:string; }
export interface WorkflowContract { version:number; id:string; name:string; createdMs:number; steps:WorkflowStep[]; }
export interface WorkflowRunResult { workflowId:string; completedSteps:number; messages:string[]; }
export interface AdapterStatus { available:boolean; version:string; detail:string; }
export interface BackupInspection { valid:boolean; fileCount:number; totalBytes:number; errors:string[]; }
