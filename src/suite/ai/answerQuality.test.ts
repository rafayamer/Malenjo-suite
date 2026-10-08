import { describe, expect, it } from 'vitest';
import type { Citation } from './rag';
import {
  aiGroundingRepairInstruction,
  shouldRegenerateAiAnswer,
  verifyAiAnswerQuality,
} from './answerQuality';

const citations:Citation[]=[
  {id:'S1',sourceId:'a',sourceName:'A.pdf',chunkId:'a:1',excerpt:'x',score:1},
  {id:'S2',sourceId:'b',sourceName:'B.pdf',chunkId:'b:1',excerpt:'y',score:1},
];

describe('AI answer quality verifier',()=>{
  it('accepts grounded factual answers with valid citations',()=>{
    const report=verifyAiAnswerQuality(
      'The manual states that thermography is performed annually. [S1]',
      citations,
      {sourcesWereAvailable:true},
    );
    expect(report.passed).toBe(true);
    expect(report.invalidCitationIds).toEqual([]);
  });

  it('rejects invented citation IDs',()=>{
    const report=verifyAiAnswerQuality(
      'The manual states that testing is monthly. [S9]',
      citations,
      {sourcesWereAvailable:true},
    );
    expect(report.passed).toBe(false);
    expect(report.invalidCitationIds).toEqual(['S9']);
    expect(shouldRegenerateAiAnswer(report)).toBe(true);
  });

  it('allows explicit insufficiency instead of forcing a citation',()=>{
    const report=verifyAiAnswerQuality(
      'The supplied sources do not state the rated power, so I cannot determine it.',
      citations,
      {sourcesWereAvailable:true},
    );
    expect(report.insufficientEvidenceAcknowledged).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('flags largely uncited factual synthesis',()=>{
    const report=verifyAiAnswerQuality(
      'Manual A recommends annual testing. [S1] Manual B specifies quarterly thermography. The system uses differential protection. The relay has three stages.',
      citations,
      {sourcesWereAvailable:true,minimumCoverage:0.7},
    );
    expect(report.passed).toBe(false);
    expect(report.citationCoverage).toBeLessThan(0.7);
    expect(aiGroundingRepairInstruction(report)).toContain('Use only the supplied [S#]');
  });
});
