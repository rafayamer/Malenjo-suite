import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AdapterStatus, BackupInspection, DmsRecord, EnterprisePolicy, RetentionCandidate,
  RoleProfile, WorkflowContract, WorkflowRunResult,
} from './types';

export const enterpriseNative=()=>isTauri();

export const listDmsRecords=()=>invoke<DmsRecord[]>('dms_list_records');
export const registerDmsDocument=(documentId:string,tags:string[],retentionDays?:number)=>invoke<DmsRecord>('dms_register_document',{documentId,tags,retentionDays});
export const snapshotDmsRecord=(recordId:string,note:string)=>invoke<DmsRecord>('dms_snapshot_record',{recordId,note});
export const updateDmsRetention=(recordId:string,retentionDays:number,legalHold:boolean)=>invoke<DmsRecord>('dms_update_retention',{recordId,retentionDays,legalHold});
export const previewRetention=()=>invoke<RetentionCandidate[]>('dms_retention_preview');
export const applyRetention=(versionIds:string[])=>invoke<number>('dms_apply_retention',{versionIds});

export const getEnterprisePolicy=()=>invoke<[EnterprisePolicy,RoleProfile[]]>('admin_get_policy');
export const updateEnterprisePolicy=(currentRole:string,defaultRetentionDays:number,auditRetentionDays:number)=>invoke<EnterprisePolicy>('admin_update_policy',{currentRole,defaultRetentionDays,auditRetentionDays});

export const listWorkflows=()=>invoke<WorkflowContract[]>('automation_list_workflows');
export const saveWorkflow=(contract:WorkflowContract)=>invoke<WorkflowContract>('automation_save_workflow',{contract});
export const runLocalWorkflow=(workflowId:string)=>invoke<WorkflowRunResult>('automation_run_local',{workflowId});
export const temporalStatus=()=>invoke<AdapterStatus>('temporal_status');
export const startTemporalWorkflow=(workflowId:string)=>invoke<string>('temporal_start_workflow',{workflowId});

export const kopiaStatus=()=>invoke<AdapterStatus>('kopia_status');
export const kopiaSnapshot=()=>invoke<string>('kopia_snapshot_app_state');
export const inspectBackup=(path:string)=>invoke<BackupInspection>('inspect_local_backup',{path});
export const restoreBackup=(backupPath:string)=>invoke<boolean>('restore_local_backup',{backupPath});

export async function createBackupWithPicker():Promise<string|null>{
  const directory=await open({directory:true,multiple:false,title:'Choose MALENJO backup destination'});
  if(!directory||Array.isArray(directory))return null;
  return invoke<string>('create_local_backup',{destinationDirectory:directory});
}
export async function inspectBackupWithPicker():Promise<{path:string;inspection:BackupInspection}|null>{
  const directory=await open({directory:true,multiple:false,title:'Choose MALENJO backup folder'});
  if(!directory||Array.isArray(directory))return null;
  return {path:directory,inspection:await inspectBackup(directory)};
}
