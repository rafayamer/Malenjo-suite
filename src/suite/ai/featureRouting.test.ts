import { describe, expect, it } from 'vitest';
import {
  aiFeatureExecutionProfile,
  assertAiFeatureReady,
  minimumContextForAiFeature,
} from './featureRouting';

describe('single-model AI feature execution profiles',()=>{
  it('routes every feature through policy settings rather than model selection',()=>{
    const chat=aiFeatureExecutionProfile('document-chat');
    const tutor=aiFeatureExecutionProfile('tutor');
    expect(chat.feature).toBe('document-chat');
    expect(tutor.requiresSources).toBe(true);
    expect(tutor.maxOutputTokens).toBeGreaterThan(chat.maxOutputTokens);
  });

  it('uses conservative Lite execution budgets without changing model identity',()=>{
    const normal=aiFeatureExecutionProfile('reader');
    const lite=aiFeatureExecutionProfile('reader',{liteMode:true});
    expect(lite.preferredContextTokens).toBeLessThanOrEqual(normal.preferredContextTokens);
    expect(lite.maxOutputTokens).toBeLessThan(normal.maxOutputTokens);
    expect(lite.minimumContextTokens).toBe(normal.minimumContextTokens);
  });

  it('requires sources for grounded document workflows',()=>{
    expect(()=>assertAiFeatureReady('summarize',{
      sourceCount:0,toolPlanningEnabled:false,
    })).toThrow(/indexed source/);
    expect(()=>assertAiFeatureReady('summarize',{
      sourceCount:1,toolPlanningEnabled:false,
    })).not.toThrow();
  });

  it('keeps tool planning behind an application-controlled gate',()=>{
    expect(()=>assertAiFeatureReady('tool-plan',{
      sourceCount:0,toolPlanningEnabled:false,
    })).toThrow(/disabled/);
    expect(()=>assertAiFeatureReady('tool-plan',{
      sourceCount:0,toolPlanningEnabled:true,
    })).not.toThrow();
  });

  it('publishes stable minimum context requirements',()=>{
    expect(minimumContextForAiFeature('classify')).toBe(1536);
    expect(minimumContextForAiFeature('reader')).toBe(2048);
  });
});
