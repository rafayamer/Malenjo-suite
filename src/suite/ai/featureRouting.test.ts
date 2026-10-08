import { describe, expect, it } from 'vitest';
import { minimumContextForAiFeature, selectAiModelForFeature } from './featureRouting';

describe('AI per-feature model routing',()=>{
  const candidates=[
    {id:'apache-small',provider:'ollama' as const,license:'Apache-2.0',resourceClass:'ultralite' as const,maxContextTokens:4096,reviewState:'reviewed' as const,installable:true},
    {id:'mit-lite',provider:'ollama' as const,license:'MIT',resourceClass:'lite' as const,maxContextTokens:4096,reviewState:'reviewed' as const,installable:true},
    {id:'unreviewed',provider:'ollama' as const,license:'MIT',resourceClass:'ultralite' as const,maxContextTokens:8192,reviewState:'candidate' as const,installable:false},
  ];

  it('prefers reviewed MIT candidates under the default policy',()=>{
    expect(selectAiModelForFeature('document-chat',candidates)?.id).toBe('mit-lite');
  });

  it('can favor the smallest reviewed profile when MIT preference is disabled',()=>{
    expect(selectAiModelForFeature('document-chat',candidates,{preferMit:false,preferLite:true})?.id).toBe('apache-small');
  });

  it('never routes to unreviewed or context-incompatible candidates',()=>{
    expect(minimumContextForAiFeature('summarize')).toBe(4096);
    expect(selectAiModelForFeature('summarize',[
      {...candidates[2],reviewState:'candidate' as const,installable:false},
      {...candidates[0],maxContextTokens:2048},
    ])).toBeNull();
  });
});
