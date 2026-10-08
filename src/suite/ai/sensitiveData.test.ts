import { describe, expect, it } from 'vitest';
import { assessAiSensitiveData, findSensitiveData, redactSensitiveData } from './sensitiveData';

describe('AI sensitive-data policy',()=>{
  it('detects common sensitive patterns without retaining the matched value',()=>{
    const text='Contact student@example.com and CNIC 12345-1234567-1.';
    const findings=findSensitiveData(text);
    expect(findings.map((item)=>item.kind)).toContain('email');
    expect(findings.map((item)=>item.kind)).toContain('national-id-like');
    expect(Object.keys(findings[0]??{})).toEqual(['kind','start','end']);
  });

  it('warns for local loopback use but blocks future remote transport',()=>{
    const text='Email me at student@example.com';
    expect(assessAiSensitiveData(text,'local-loopback').action).toBe('warn');
    expect(assessAiSensitiveData(text,'remote').action).toBe('block');
  });

  it('redacts detected values deterministically',()=>{
    const redacted=redactSensitiveData('Token sk-abcdefghijklmnop belongs to student@example.com.');
    expect(redacted).not.toContain('abcdefghijklmnop');
    expect(redacted).not.toContain('student@example.com');
    expect(redacted).toContain('[REDACTED:access-token-like]');
    expect(redacted).toContain('[REDACTED:email]');
  });
});
