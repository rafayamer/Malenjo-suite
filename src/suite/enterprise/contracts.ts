import type { WorkflowContract, WorkflowStep } from './types';

export function newWorkflow(name:string): WorkflowContract {
  return { version:1, id:'', name:name.trim(), createdMs:0, steps:[] };
}

export function addAuditStep(contract:WorkflowContract,note:string):WorkflowContract {
  return { ...contract, steps:[...contract.steps,{ kind:'audit', note:note.trim().slice(0,300) }] };
}

export function addSnapshotStep(contract:WorkflowContract,recordId:string,note:string):WorkflowContract {
  if(!recordId) throw new Error('Choose a DMS record for the snapshot step.');
  return { ...contract, steps:[...contract.steps,{ kind:'dms_snapshot', recordId, note:note.trim().slice(0,300) }] };
}

export function validateWorkflow(contract:WorkflowContract):string[] {
  const errors:string[]=[];
  if(!contract.name.trim()||contract.name.length>120) errors.push('Workflow name must contain 1-120 characters.');
  if(!contract.steps.length||contract.steps.length>20) errors.push('Workflow must contain 1-20 steps.');
  for(const step of contract.steps){
    if(step.kind==='dms_snapshot'&&!step.recordId) errors.push('Snapshot step requires a DMS record.');
  }
  return errors;
}

export function describeStep(step:WorkflowStep):string {
  return step.kind==='audit'
    ? `Audit: ${step.note||'checkpoint'}`
    : `DMS snapshot: ${step.recordId} · ${step.note||'snapshot'}`;
}
