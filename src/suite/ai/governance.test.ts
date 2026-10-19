import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_ENTERPRISE_POLICY,
  canRetainAiRecord,
  decideAiEnterprisePolicy,
  redactAiPolicyForClient,
  validateAiEnterprisePolicy,
} from './governance';

describe('enterprise AI governance',()=>{
  it('validates the default offline/audited policy',()=>{
    const policy=validateAiEnterprisePolicy(DEFAULT_AI_ENTERPRISE_POLICY);
    expect(policy.offlineOnly).toBe(true);
    expect(policy.requireAudit).toBe(true);
    expect(policy.rolePermissions.viewer).not.toContain('tool-write');
  });

  it('blocks remote transport under offline-only policy',()=>{
    const decision=decideAiEnterprisePolicy(DEFAULT_AI_ENTERPRISE_POLICY,{
      role:'editor',
      classification:'confidential',
      feature:'reader',
      localTransport:false,
      auditAvailable:true,
      persistentMemoryRequested:false,
      notebookDocumentCount:2,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/local\/offline/);
  });

  it('enforces role permission and audit requirements',()=>{
    expect(decideAiEnterprisePolicy(DEFAULT_AI_ENTERPRISE_POLICY,{
      role:'viewer',classification:'internal',feature:'tool-write',
      localTransport:true,auditAvailable:true,persistentMemoryRequested:false,notebookDocumentCount:1,
    }).allowed).toBe(false);
    expect(decideAiEnterprisePolicy(DEFAULT_AI_ENTERPRISE_POLICY,{
      role:'editor',classification:'internal',feature:'reader',
      localTransport:true,auditAvailable:false,persistentMemoryRequested:false,notebookDocumentCount:1,
    }).allowed).toBe(false);
  });

  it('enforces retention windows',()=>{
    const day=24*60*60*1000;
    expect(canRetainAiRecord(DEFAULT_AI_ENTERPRISE_POLICY,100*day,120*day)).toBe(true);
    expect(canRetainAiRecord(DEFAULT_AI_ENTERPRISE_POLICY,80*day,120*day)).toBe(false);
  });

  it('does not expose role permission internals through the client summary helper',()=>{
    const client=redactAiPolicyForClient(DEFAULT_AI_ENTERPRISE_POLICY);
    expect(client).not.toHaveProperty('rolePermissions');
    expect(client.offlineOnly).toBe(true);
  });
});
