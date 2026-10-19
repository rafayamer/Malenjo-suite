import { describe, expect, it } from 'vitest';
import {
  aiTutorStructuredContract,
  gradeAiQuiz,
  nextTutorTopics,
  validateAiFlashcards,
  validateAiQuiz,
  validateAiStudyPlan,
} from './tutor';

const allowed=new Set(['doc-a','doc-b']);

describe('AI tutor core',()=>{
  it('requires citations for study-plan units',()=>{
    expect(()=>validateAiStudyPlan({
      title:'Protection',
      mode:'exam-prep',
      units:[{id:'u1',title:'Differential',objectives:['Explain operation'],sourceIds:[],estimatedMinutes:20}],
    },allowed)).toThrow(/cite/i);
  });

  it('validates source-grounded flashcards',()=>{
    const cards=validateAiFlashcards([{
      id:'c1',front:'What does CT mean?',back:'Current transformer.',topic:'Protection',sourceIds:['doc-a'],
    }],allowed);
    expect(cards[0]?.sourceIds).toEqual(['doc-a']);
  });

  it('grades deterministic quiz types and leaves free text reviewable',()=>{
    const quiz=validateAiQuiz({
      title:'Quiz',
      questions:[
        {id:'q1',type:'mcq',prompt:'CT?',options:['Current transformer','Circuit timer'],correctIndex:0,explanation:'CT means current transformer.',topic:'Protection',sourceIds:['doc-a']},
        {id:'q2',type:'true-false',prompt:'VCB uses vacuum.',correct:true,explanation:'Correct.',topic:'Switchgear',sourceIds:['doc-b']},
        {id:'q3',type:'short-answer',prompt:'Explain differential protection.',referenceAnswer:'Compare current entering and leaving.',explanation:'Use protected-zone balance.',topic:'Protection',sourceIds:['doc-a']},
      ],
    },allowed);
    const grade=gradeAiQuiz(quiz,[
      {questionId:'q1',answer:1},
      {questionId:'q2',answer:true},
      {questionId:'q3',answer:'It compares currents.'},
    ]);
    expect(grade.graded).toBe(2);
    expect(grade.correct).toBe(1);
    expect(grade.items[2]?.needsReview).toBe(true);
    expect(grade.weakTopics).toContain('Protection');
  });

  it('prioritizes weakest and oldest study topics',()=>{
    expect(nextTutorTopics([
      {topic:'A',mastery:0.8,lastReviewedAt:10},
      {topic:'B',mastery:0.2,lastReviewedAt:20},
      {topic:'C',mastery:0.2,lastReviewedAt:5},
    ],2)).toEqual(['C','B']);
  });

  it('defines source-grounded tutor rules',()=>{
    expect(aiTutorStructuredContract()).toContain('Never invent source IDs');
  });
});
