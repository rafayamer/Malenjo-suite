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

  it('retains a later independent secret after discarding an overlapping match',()=>{
    const text='sk-abcdefghijkl12345678 4111111111111111';
    const findings=findSensitiveData(text);
    expect(findings.map((item)=>item.kind)).toEqual(['access-token-like','payment-card-like']);
    const redacted=redactSensitiveData(text);
    expect(redacted).not.toContain('4111111111111111');
    expect(redacted).toContain('[REDACTED:payment-card-like]');
  });

  it('does not classify ordinary dates or four-four references as phones',()=>{
    expect(findSensitiveData('Meeting date 2026-10-08.').some((item)=>item.kind==='phone-like')).toBe(false);
    expect(findSensitiveData('Meeting date 08-10-2026.').some((item)=>item.kind==='phone-like')).toBe(false);
    expect(findSensitiveData('Reference 1234-5678.').some((item)=>item.kind==='phone-like')).toBe(false);
    expect(findSensitiveData('Call +92 300 1234567.').some((item)=>item.kind==='phone-like')).toBe(true);
  });

  it('does not treat arbitrary 13-digit identifiers as payment cards',()=>{
    expect(findSensitiveData('ISBN 9780131103627').some((item)=>item.kind==='payment-card-like')).toBe(false);
    expect(findSensitiveData('Card 4111111111111111').some((item)=>item.kind==='payment-card-like')).toBe(true);
  });

  it('detects common key-value credential forms',()=>{
    for(const text of [
      'token: abcdefghijklmnopqrstuvwxyz',
      'api_key=abcdefghijklmnopqrstuvwxyz',
      'access-token = abcdefghijklmnopqrstuvwxyz',
    ]){
      const assessment=assessAiSensitiveData(text,'remote');
      expect(assessment.action).toBe('block');
      expect(assessment.findings.some((item)=>item.kind==='access-token-like')).toBe(true);
      expect(redactSensitiveData(text)).toContain('[REDACTED:access-token-like]');
    }
  });

  it('covers the complete bearer-token alphabet and redacts the whole credential',()=>{
    const text='Authorization: Bearer abcde/fghijklmnopqrstuvwxyz====';
    const assessment=assessAiSensitiveData(text,'remote');
    expect(assessment.action).toBe('block');
    expect(assessment.findings.some((item)=>item.kind==='access-token-like')).toBe(true);
    const redacted=redactSensitiveData(text);
    expect(redacted).not.toContain('abcde/fghijklmnopqrstuvwxyz===');
    expect(redacted).toContain('[REDACTED:access-token-like]');
  });
});
