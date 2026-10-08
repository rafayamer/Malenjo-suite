import { describe, expect, it } from 'vitest';
import { appendAiAuditRecord, createAiAuditRecord, serializeAiAuditLog } from './audit';

describe('AI privacy-safe audit records',()=>{
  it('records operational metadata without prompt, source or answer content',()=>{
    const record=createAiAuditRecord({
      feature:'document-chat',
      provider:'ollama',
      model:'phi3:test',
      modelProfileId:'profile-1',
      promptPolicyId:'document-chat-v1',
      status:'success',
      latencyMs:120,
      sourceCount:2,
      citationCount:1,
      inputChars:500,
      outputChars:200,
      policyWarnings:[],
    });
    const keys=Object.keys(record);
    expect(keys).not.toContain('promptText');
    expect(keys).not.toContain('promptContent');
    expect(keys).not.toContain('sourceText');
    expect(keys).not.toContain('sourceContent');
    expect(keys).not.toContain('answer');
    expect(keys).not.toContain('answerText');
    expect(record.promptPolicyId).toBe('document-chat-v1');
    expect(record.schemaVersion).toBe(1);
  });

  it('sanitizes labels and bounds warning volume',()=>{
    const record=createAiAuditRecord({
      feature:'extract',provider:'none',promptPolicyId:'extract-v1',status:'blocked',
      latencyMs:null,sourceCount:0,citationCount:0,inputChars:1,outputChars:0,
      model:'bad\u0085model',policyWarnings:Array.from({length:50},(_,i)=>`warning-${i}`),
    });
    expect(record.model).toBe('bad model');
    expect(record.policyWarnings).toHaveLength(20);
  });

  it('keeps only the most recent bounded audit records',()=>{
    let log=[] as ReturnType<typeof createAiAuditRecord>[];
    for(let i=0;i<520;i+=1){
      log=appendAiAuditRecord(log,createAiAuditRecord({
        timestampMs:i,feature:'rewrite',provider:'none',promptPolicyId:'rewrite-v1',status:'success',
        latencyMs:0,sourceCount:0,citationCount:0,inputChars:1,outputChars:1,
      }));
    }
    expect(log).toHaveLength(500);
    expect(log[0]?.timestampMs).toBe(20);
    expect(serializeAiAuditLog(log).split('\n')).toHaveLength(500);
  });
});
