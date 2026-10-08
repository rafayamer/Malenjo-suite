export type AiTutorMode='beginner'|'deep-study'|'exam-prep'|'revision';

export interface AiStudyPlanUnit{
  id:string;
  title:string;
  objectives:string[];
  sourceIds:string[];
  estimatedMinutes:number;
}

export interface AiStudyPlan{
  title:string;
  mode:AiTutorMode;
  units:AiStudyPlanUnit[];
}

export interface AiFlashcard{
  id:string;
  front:string;
  back:string;
  sourceIds:string[];
  topic:string;
}

export type AiQuizQuestion=
  |{
      id:string;
      type:'mcq';
      prompt:string;
      options:string[];
      correctIndex:number;
      explanation:string;
      sourceIds:string[];
      topic:string;
    }
  |{
      id:string;
      type:'true-false';
      prompt:string;
      correct:boolean;
      explanation:string;
      sourceIds:string[];
      topic:string;
    }
  |{
      id:string;
      type:'short-answer';
      prompt:string;
      referenceAnswer:string;
      explanation:string;
      sourceIds:string[];
      topic:string;
    };

export interface AiQuiz{
  title:string;
  questions:AiQuizQuestion[];
}

export interface AiQuizAnswer{
  questionId:string;
  answer:number|boolean|string;
}

export interface AiQuizGradeItem{
  questionId:string;
  topic:string;
  correct:boolean|null;
  needsReview:boolean;
  explanation:string;
}

export interface AiQuizGrade{
  correct:number;
  graded:number;
  total:number;
  score:number|null;
  items:AiQuizGradeItem[];
  weakTopics:string[];
}

export const AI_TUTOR_LIMITS={
  maxPlanUnits:40,
  maxObjectivesPerUnit:12,
  maxFlashcards:200,
  maxQuizQuestions:100,
  maxSourcesPerItem:12,
} as const;

function clean(value:string,max=2_000):string{
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g,' ').trim().slice(0,max);
}

function validSources(sourceIds:string[],allowed:Set<string>):string[]{
  const result=Array.from(new Set(sourceIds.map((id)=>clean(id,220)).filter((id)=>allowed.has(id))));
  if(!result.length)throw new Error('Tutor artifact item must cite at least one authorized source.');
  return result.slice(0,AI_TUTOR_LIMITS.maxSourcesPerItem);
}

export function validateAiStudyPlan(value:unknown,allowedSources:Set<string>):AiStudyPlan{
  if(!value||typeof value!=='object')throw new Error('Study plan must be an object.');
  const input=value as Partial<AiStudyPlan>;
  if(!['beginner','deep-study','exam-prep','revision'].includes(String(input.mode)))throw new Error('Study plan mode is invalid.');
  if(!Array.isArray(input.units)||!input.units.length||input.units.length>AI_TUTOR_LIMITS.maxPlanUnits)throw new Error('Study plan unit count is invalid.');
  const units=input.units.map((unit,index)=>{
    if(!unit||typeof unit!=='object')throw new Error('Study plan unit is invalid.');
    const item=unit as AiStudyPlanUnit;
    const title=clean(item.title,300);
    if(!title)throw new Error('Study plan unit title is required.');
    if(!Array.isArray(item.objectives)||!item.objectives.length||item.objectives.length>AI_TUTOR_LIMITS.maxObjectivesPerUnit){
      throw new Error('Study plan unit objectives are invalid.');
    }
    return {
      id:clean(item.id,120)||`unit-${index+1}`,
      title,
      objectives:item.objectives.map((objective)=>clean(objective,500)).filter(Boolean),
      sourceIds:validSources(item.sourceIds??[],allowedSources),
      estimatedMinutes:Math.max(1,Math.min(240,Math.floor(Number(item.estimatedMinutes)||20))),
    };
  });
  return {
    title:clean(input.title??'',300)||'Study plan',
    mode:input.mode as AiTutorMode,
    units,
  };
}

export function validateAiFlashcards(value:unknown,allowedSources:Set<string>):AiFlashcard[]{
  if(!Array.isArray(value)||value.length>AI_TUTOR_LIMITS.maxFlashcards)throw new Error('Flashcard list is invalid.');
  return value.map((raw,index)=>{
    if(!raw||typeof raw!=='object')throw new Error('Flashcard is invalid.');
    const item=raw as AiFlashcard;
    const front=clean(item.front,1_000);
    const back=clean(item.back,2_000);
    if(!front||!back)throw new Error('Flashcard front/back are required.');
    return {
      id:clean(item.id,120)||`card-${index+1}`,
      front,
      back,
      topic:clean(item.topic,240)||'General',
      sourceIds:validSources(item.sourceIds??[],allowedSources),
    };
  });
}

export function validateAiQuiz(value:unknown,allowedSources:Set<string>):AiQuiz{
  if(!value||typeof value!=='object')throw new Error('Quiz must be an object.');
  const input=value as Partial<AiQuiz>;
  if(!Array.isArray(input.questions)||!input.questions.length||input.questions.length>AI_TUTOR_LIMITS.maxQuizQuestions){
    throw new Error('Quiz question count is invalid.');
  }

  const questions=input.questions.map((raw,index):AiQuizQuestion=>{
    if(!raw||typeof raw!=='object')throw new Error('Quiz question is invalid.');
    const item=raw as Partial<AiQuizQuestion>&Record<string,unknown>;
    const common={
      id:clean(String(item.id??''),120)||`q-${index+1}`,
      prompt:clean(String(item.prompt??''),2_000),
      explanation:clean(String(item.explanation??''),3_000),
      topic:clean(String(item.topic??''),240)||'General',
      sourceIds:validSources(Array.isArray(item.sourceIds)?item.sourceIds as string[]:[],allowedSources),
    };
    if(!common.prompt)throw new Error('Quiz prompt is required.');

    if(item.type==='mcq'){
      if(!Array.isArray(item.options)||item.options.length<2||item.options.length>8)throw new Error('MCQ options are invalid.');
      const options=item.options.map((option)=>clean(String(option),800));
      const correctIndex=Math.floor(Number(item.correctIndex));
      if(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length)throw new Error('MCQ correct index is invalid.');
      return {...common,type:'mcq',options,correctIndex};
    }
    if(item.type==='true-false'){
      if(typeof item.correct!=='boolean')throw new Error('True/false answer is invalid.');
      return {...common,type:'true-false',correct:item.correct};
    }
    if(item.type==='short-answer'){
      const referenceAnswer=clean(String(item.referenceAnswer??''),2_000);
      if(!referenceAnswer)throw new Error('Short-answer reference answer is required.');
      return {...common,type:'short-answer',referenceAnswer};
    }
    throw new Error('Quiz question type is invalid.');
  });

  return {title:clean(input.title??'',300)||'Quiz',questions};
}

export function gradeAiQuiz(quiz:AiQuiz,answers:AiQuizAnswer[]):AiQuizGrade{
  const byId=new Map(answers.map((answer)=>[answer.questionId,answer.answer]));
  const items:AiQuizGradeItem[]=[];
  let correct=0;
  let graded=0;
  const misses=new Map<string,number>();

  for(const question of quiz.questions){
    const answer=byId.get(question.id);
    let result:boolean|null=null;
    let needsReview=false;

    if(question.type==='mcq'){
      result=typeof answer==='number'&&Number.isInteger(answer)&&answer===question.correctIndex;
    }else if(question.type==='true-false'){
      result=typeof answer==='boolean'&&answer===question.correct;
    }else{
      // Free-text semantic grading is intentionally not guessed by deterministic code.
      // A later model-assisted grader must cite the reference/source and remain reviewable.
      result=null;
      needsReview=true;
    }

    if(result!==null){
      graded+=1;
      if(result)correct+=1;
      else misses.set(question.topic,(misses.get(question.topic)??0)+1);
    }

    items.push({
      questionId:question.id,
      topic:question.topic,
      correct:result,
      needsReview,
      explanation:question.explanation,
    });
  }

  return {
    correct,
    graded,
    total:quiz.questions.length,
    score:graded?Math.round((correct/graded)*1000)/1000:null,
    items,
    weakTopics:Array.from(misses.entries()).sort((a,b)=>b[1]-a[1]).map(([topic])=>topic),
  };
}

export function nextTutorTopics(
  progress:Array<{topic:string;mastery:number;lastReviewedAt:number|null}>,
  limit=5,
):string[]{
  return [...progress]
    .sort((a,b)=>{
      if(a.mastery!==b.mastery)return a.mastery-b.mastery;
      return (a.lastReviewedAt??0)-(b.lastReviewedAt??0);
    })
    .slice(0,Math.max(1,Math.min(limit,20)))
    .map((item)=>item.topic);
}

export function aiTutorStructuredContract():string{
  return [
    'TUTOR OUTPUT RULES:',
    '- Every factual study-plan unit, flashcard, and quiz question must cite one or more authorized source IDs.',
    '- Never invent source IDs.',
    '- Preserve disagreements between sources rather than merging them silently.',
    '- Short-answer grading is reviewable; deterministic code does not pretend to semantically grade free text.',
    '- Prefer teaching explanations, retrieval practice, and weak-topic review over merely repeating summaries.',
  ].join('\n');
}
