import { describe, expect, it } from 'vitest';
import {
  aiContextBudget,
  assertAiPlanReady,
  routeAiAssistantRequest,
  validateAiAssistantPlan,
} from './orchestrator';

describe('AI assistant orchestrator',()=>{
  it('routes learning requests to the tutor workflow',()=>{
    const plan=routeAiAssistantRequest('Quiz me on these PDFs',{hasNotebook:true,sourceCount:5,toolRequestDetected:false});
    expect(plan.route).toBe('tutor');
    expect(plan.requiresNotebook).toBe(true);
  });

  it('routes application actions through the controlled tool lane',()=>{
    const plan=routeAiAssistantRequest('Open page 12 of the cited PDF',{hasNotebook:true,sourceCount:2,toolRequestDetected:false});
    expect(plan.route).toBe('tool');
    expect(plan.allowTools).toBe(true);
  });

  it('defaults document questions to grounded notebook QA',()=>{
    expect(routeAiAssistantRequest('Why is this relay used?',{
      hasNotebook:false,sourceCount:3,toolRequestDetected:false,
    }).route).toBe('notebook-qa');
  });

  it('keeps normal conversation possible when no sources exist',()=>{
    expect(routeAiAssistantRequest('Hello, how are you?',{
      hasNotebook:false,sourceCount:0,toolRequestDetected:false,
    }).route).toBe('conversation');
  });

  it('blocks routes whose required context is missing',()=>{
    const plan=routeAiAssistantRequest('Teach me this',{hasNotebook:false,sourceCount:1,toolRequestDetected:false});
    expect(()=>assertAiPlanReady(plan,{hasNotebook:false,sourceCount:1,toolRequestDetected:false})).toThrow(/Notebook/);
  });

  it('uses tighter Lite context budgets',()=>{
    const lite=aiContextBudget(true,'reader');
    const standard=aiContextBudget(false,'reader');
    expect(lite.maxSourceChars).toBeLessThan(standard.maxSourceChars);
    expect(lite.maxOutputTokens).toBeLessThan(standard.maxOutputTokens);
  });

  it('refuses planner outputs that authorize tools on non-tool routes',()=>{
    expect(()=>validateAiAssistantPlan({
      route:'conversation',requiresNotebook:false,requiresSources:false,allowTools:true,reason:'',
    })).toThrow(/Only the tool route/);
  });
});
