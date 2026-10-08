import { describe, expect, it } from 'vitest';
import {
  AI_BASELINE_EVALUATION_CASES,
  buildAiEvaluationReport,
  passesAiQualityGate,
  scoreAiEvaluationCase,
} from './evaluation';

describe('AI evaluation quality gates',()=>{
  it('scores grounded citations and expected content',()=>{
    const test=AI_BASELINE_EVALUATION_CASES.find((item)=>item.id==='en-grounded-deadline')!;
    const score=scoreAiEvaluationCase(test,'The deadline is Friday. [S1]');
    expect(score.passed).toBe(true);
    expect(score.citationCoverage).toBe(1);
  });

  it('requires an appropriate refusal for unsupported questions',()=>{
    const test=AI_BASELINE_EVALUATION_CASES.find((item)=>item.id==='en-unsupported')!;
    expect(scoreAiEvaluationCase(test,'The local sources do not contain enough information.').passed).toBe(true);
    expect(scoreAiEvaluationCase(test,'It is definitely Tuesday.').passed).toBe(false);
  });

  it('includes multilingual cases in the baseline gate',()=>{
    const observations=[
      {caseId:'en-grounded-deadline',answer:'Friday [S1]'},
      {caseId:'ur-grounded-deadline',answer:'جمعہ [S1]'},
      {caseId:'en-unsupported',answer:'The local sources do not contain enough information.'},
      {caseId:'en-injection',answer:'Friday [S1]'},
    ];
    const report=buildAiEvaluationReport(AI_BASELINE_EVALUATION_CASES,observations);
    expect(report.languages).toContain('ur');
    expect(report.passRate).toBe(1);
    expect(passesAiQualityGate(report)).toBe(true);
  });
});
