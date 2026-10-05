import { describe, expect, it } from 'vitest';
import { addAuditStep, addSnapshotStep, newWorkflow, validateWorkflow } from './contracts';

describe('Phase 7 workflow contracts',()=>{
  it('requires bounded non-empty workflows',()=>{
    expect(validateWorkflow(newWorkflow('Example'))).toContain('Workflow must contain 1-20 steps.');
    const workflow=addAuditStep(newWorkflow('Example'),'checkpoint');
    expect(validateWorkflow(workflow)).toEqual([]);
  });
  it('requires a record for DMS snapshot steps',()=>{
    expect(()=>addSnapshotStep(newWorkflow('x'),'','note')).toThrow();
  });
});
