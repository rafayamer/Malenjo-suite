import { describe, expect, it } from 'vitest';
import {
  aiReaderContract,
  aiReaderEvidenceReport,
  sourceComparisonMatrix,
  validateAiReaderSynthesis,
} from './reader';

const allowed=new Set(['a','b','c']);

describe('AI reader/research core',()=>{
  const raw={
    title:'Maintenance comparison',
    summary:'The manuals specify different thermography intervals.',
    summarySourceIds:['a','b'],
    claims:[
      {text:'Manual A recommends annual thermography.',sourceIds:['a']},
      {text:'Manual B recommends quarterly thermography.',sourceIds:['b']},
    ],
    disagreements:[
      {
        topic:'Thermography interval',
        positions:[
          {text:'Annual',sourceIds:['a']},
          {text:'Quarterly',sourceIds:['b']},
        ],
      },
    ],
    unknowns:['The supplied sources do not establish which schedule controls.'],
  };

  it('accepts source-grounded synthesis and reports coverage',()=>{
    const synthesis=validateAiReaderSynthesis(raw,allowed);
    const report=aiReaderEvidenceReport(synthesis,allowed);
    expect(report.uncitedClaims).toBe(0);
    expect(report.citedSourceCount).toBe(2);
    expect(report.coverage).toBeCloseTo(2/3,3);
  });

  it('rejects invented source IDs',()=>{
    expect(()=>validateAiReaderSynthesis({
      ...raw,
      claims:[{text:'Invented claim',sourceIds:['made-up']}],
    },allowed)).toThrow(/unauthorized source/i);
  });

  it('builds explicit per-source disagreement rows',()=>{
    const synthesis=validateAiReaderSynthesis(raw,allowed);
    const rows=sourceComparisonMatrix(synthesis,['a','b']);
    expect(rows[0]?.bySource.a).toEqual(['Annual']);
    expect(rows[0]?.bySource.b).toEqual(['Quarterly']);
  });

  it('publishes evidence-first research rules',()=>{
    expect(aiReaderContract()).toContain('Put unsupported requested facts in unknowns');
  });
});
