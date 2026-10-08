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

  it('bounds label sanitization before processing huge restored strings',()=>{
    const huge='x'.repeat(2_000_000)+'SECRET_TAIL';
    const record=createAiAuditRecord({
      feature:'extract',provider:'none',promptPolicyId:huge,status:'error',
      latencyMs:null,sourceCount:0,citationCount:0,inputChars:1,outputChars:0,
      model:huge,errorCode:huge,
    });
    expect(record.model?.length).toBeLessThanOrEqual(160);
    expect(record.promptPolicyId.length).toBeLessThanOrEqual(120);
    expect(record.errorCode?.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(record)).not.toContain('SECRET_TAIL');
  });

  it('sanitizes labels and bounds warning volume',()=>{
    const record=createAiAuditRecord({
      feature:'extract',provider:'none',promptPolicyId:'extract-v1',status:'blocked',
      latencyMs:null,sourceCount:0,citationCount:0,inputChars:1,outputChars:0,
      model:'bad\u0085model',policyWarnings:Array.from({length:50},(_,i)=>`warning-${i}`),
    });
    expect(record.model).toBe('bad model');
    expect(record.policyWarnings).toHaveLength(20);
    const huge=createAiAuditRecord({
      feature:'extract',provider:'none',promptPolicyId:'extract-v1',status:'blocked',
      latencyMs:null,sourceCount:0,citationCount:0,inputChars:1,outputChars:0,
      policyWarnings:Array.from({length:100_000},(_,i)=>i<100?`warning-${i}`:'late-warning'),
    });
    expect(huge.policyWarnings).toHaveLength(20);
    expect(huge.policyWarnings).not.toContain('late-warning');
  });

  it('whitelists schema fields during serialization',()=>{
    const record=createAiAuditRecord({
      feature:'document-chat',provider:'ollama',promptPolicyId:'document-chat-v1',status:'success',
      latencyMs:10,sourceCount:1,citationCount:1,inputChars:10,outputChars:10,
    }) as ReturnType<typeof createAiAuditRecord>&{promptText?:string;sourceContent?:string};
    record.promptText='SECRET PROMPT';
    record.sourceContent='SECRET SOURCE';
    const serialized=serializeAiAuditLog([record]);
    expect(serialized).not.toContain('SECRET PROMPT');
    expect(serialized).not.toContain('SECRET SOURCE');
    expect(serialized).not.toContain('promptText');
    expect(serialized).not.toContain('sourceContent');
  });

  it('bounds restored warning arrays before snapshotting',()=>{
    const record=createAiAuditRecord({
      feature:'rewrite',provider:'none',promptPolicyId:'rewrite-v1',status:'success',
      latencyMs:0,sourceCount:0,citationCount:0,inputChars:1,outputChars:1,
    }) as ReturnType<typeof createAiAuditRecord>;
    record.policyWarnings=Array.from({length:100_000},(_,index)=>`warning-${index}`);
    const log=appendAiAuditRecord([],record);
    expect(log[0]?.policyWarnings).toHaveLength(20);
    expect(log[0]?.policyWarnings[19]).toBe('warning-19');
  });

  it('snapshots appended records so later mutations cannot rewrite history',()=>{
    const record=createAiAuditRecord({
      feature:'rewrite',provider:'none',promptPolicyId:'rewrite-v1',status:'success',
      latencyMs:0,sourceCount:0,citationCount:0,inputChars:1,outputChars:1,
      policyWarnings:['original'],
    });
    const log=appendAiAuditRecord([],record);
    record.status='error';
    record.policyWarnings.push('mutated');
    expect(log[0]?.status).toBe('success');
    expect(log[0]?.policyWarnings).toEqual(['original']);
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
