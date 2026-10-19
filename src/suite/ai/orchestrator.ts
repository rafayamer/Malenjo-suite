export type AiAssistantRoute=
  |'conversation'
  |'notebook-qa'
  |'tutor'
  |'reader'
  |'compare'
  |'summarize'
  |'tool';

export interface AiAssistantState{
  hasNotebook:boolean;
  sourceCount:number;
  toolRequestDetected:boolean;
}

export interface AiAssistantPlan{
  route:AiAssistantRoute;
  requiresNotebook:boolean;
  requiresSources:boolean;
  allowTools:boolean;
  reason:string;
}

export interface AiContextBudget{
  maxHistoryChars:number;
  maxMemoryChars:number;
  maxSourceChars:number;
  maxSources:number;
  maxOutputTokens:number;
}

function normalized(value:string):string{
  return value.toLocaleLowerCase().replace(/\s+/g,' ').trim();
}

function includesAny(value:string,terms:string[]):boolean{
  return terms.some((term)=>value.includes(term));
}

export function routeAiAssistantRequest(
  request:string,
  state:AiAssistantState,
):AiAssistantPlan{
  const q=normalized(request);
  const toolIntent=state.toolRequestDetected||includesAny(q,[
    'open page','go to page','create note','save note','export','run ocr','fill form','redact','delete page',
  ]);
  if(toolIntent){
    return {
      route:'tool',
      requiresNotebook:false,
      requiresSources:false,
      allowTools:true,
      reason:'The request asks MALENJO to perform or navigate an application action.',
    };
  }

  if(includesAny(q,['quiz me','flashcard','teach me','study plan','exam prep','test me','weak topic','explain like a beginner'])){
    return {
      route:'tutor',
      requiresNotebook:true,
      requiresSources:true,
      allowTools:false,
      reason:'The request is a learning/tutoring workflow.',
    };
  }

  if(includesAny(q,['compare','difference between','disagree','contradiction','versus',' vs '])){
    return {
      route:'compare',
      requiresNotebook:true,
      requiresSources:true,
      allowTools:false,
      reason:'The request requires explicit cross-source comparison.',
    };
  }

  if(includesAny(q,['summarize','summary','key points','main points','executive summary'])){
    return {
      route:'summarize',
      requiresNotebook:false,
      requiresSources:true,
      allowTools:false,
      reason:'The request asks for a source-grounded summary.',
    };
  }

  if(includesAny(q,['research','what do the documents say','synthesize','find all','timeline','claims','evidence'])){
    return {
      route:'reader',
      requiresNotebook:true,
      requiresSources:true,
      allowTools:false,
      reason:'The request is a reader/research synthesis workflow.',
    };
  }

  if(state.sourceCount>0){
    return {
      route:'notebook-qa',
      requiresNotebook:false,
      requiresSources:true,
      allowTools:false,
      reason:'Local sources are available, so factual document questions should use grounded retrieval.',
    };
  }

  return {
    route:'conversation',
    requiresNotebook:false,
    requiresSources:false,
    allowTools:false,
    reason:'No document or tool workflow was detected.',
  };
}

export function validateAiAssistantPlan(value:unknown):AiAssistantPlan{
  if(!value||typeof value!=='object')throw new Error('Assistant plan must be an object.');
  const input=value as Partial<AiAssistantPlan>;
  const routes:AiAssistantRoute[]=['conversation','notebook-qa','tutor','reader','compare','summarize','tool'];
  if(!routes.includes(input.route as AiAssistantRoute))throw new Error('Assistant route is invalid.');
  if(typeof input.requiresNotebook!=='boolean'||typeof input.requiresSources!=='boolean'||typeof input.allowTools!=='boolean'){
    throw new Error('Assistant plan flags are invalid.');
  }
  if(input.route!=='tool'&&input.allowTools)throw new Error('Only the tool route may authorize tool planning.');
  return {
    route:input.route as AiAssistantRoute,
    requiresNotebook:input.requiresNotebook,
    requiresSources:input.requiresSources,
    allowTools:input.allowTools,
    reason:typeof input.reason==='string'?input.reason.slice(0,1000):'',
  };
}

export function aiContextBudget(liteMode:boolean,route:AiAssistantRoute):AiContextBudget{
  if(liteMode){
    const sourceHeavy=['notebook-qa','reader','compare','summarize','tutor'].includes(route);
    return {
      maxHistoryChars:route==='conversation'?8_000:4_000,
      maxMemoryChars:2_000,
      maxSourceChars:sourceHeavy?12_000:4_000,
      maxSources:sourceHeavy?4:2,
      maxOutputTokens:route==='tutor'||route==='reader'?192:128,
    };
  }
  return {
    maxHistoryChars:18_000,
    maxMemoryChars:6_000,
    maxSourceChars:40_000,
    maxSources:['reader','compare'].includes(route)?10:8,
    maxOutputTokens:['reader','tutor','compare'].includes(route)?900:600,
  };
}

export function assertAiPlanReady(plan:AiAssistantPlan,state:AiAssistantState):void{
  if(plan.requiresNotebook&&!state.hasNotebook)throw new Error('This AI workflow requires an active Notebook.');
  if(plan.requiresSources&&state.sourceCount<1)throw new Error('This AI workflow requires at least one indexed source.');
}
