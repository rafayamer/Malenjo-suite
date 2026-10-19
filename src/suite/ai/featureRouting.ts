export type AiFeature=
  |'document-chat'
  |'summarize'
  |'extract'
  |'classify'
  |'rewrite'
  |'tutor'
  |'reader'
  |'compare'
  |'tool-plan';

export interface AiFeatureExecutionProfile{
  feature:AiFeature;
  minimumContextTokens:number;
  preferredContextTokens:number;
  maxOutputTokens:number;
  temperature:number;
  requiresSources:boolean;
  allowToolPlanning:boolean;
}

const PROFILES:Record<AiFeature,AiFeatureExecutionProfile>={
  'document-chat':{
    feature:'document-chat',minimumContextTokens:1536,preferredContextTokens:4096,
    maxOutputTokens:600,temperature:0.3,requiresSources:true,allowToolPlanning:false,
  },
  summarize:{
    feature:'summarize',minimumContextTokens:2048,preferredContextTokens:4096,
    maxOutputTokens:800,temperature:0.2,requiresSources:true,allowToolPlanning:false,
  },
  extract:{
    feature:'extract',minimumContextTokens:2048,preferredContextTokens:4096,
    maxOutputTokens:700,temperature:0.1,requiresSources:true,allowToolPlanning:false,
  },
  classify:{
    feature:'classify',minimumContextTokens:1536,preferredContextTokens:2048,
    maxOutputTokens:200,temperature:0,requiresSources:true,allowToolPlanning:false,
  },
  rewrite:{
    feature:'rewrite',minimumContextTokens:1536,preferredContextTokens:4096,
    maxOutputTokens:900,temperature:0.35,requiresSources:false,allowToolPlanning:false,
  },
  tutor:{
    feature:'tutor',minimumContextTokens:2048,preferredContextTokens:4096,
    maxOutputTokens:900,temperature:0.35,requiresSources:true,allowToolPlanning:false,
  },
  reader:{
    feature:'reader',minimumContextTokens:2048,preferredContextTokens:4096,
    maxOutputTokens:1000,temperature:0.2,requiresSources:true,allowToolPlanning:false,
  },
  compare:{
    feature:'compare',minimumContextTokens:2048,preferredContextTokens:4096,
    maxOutputTokens:1000,temperature:0.15,requiresSources:true,allowToolPlanning:false,
  },
  'tool-plan':{
    feature:'tool-plan',minimumContextTokens:1536,preferredContextTokens:2048,
    maxOutputTokens:300,temperature:0,requiresSources:false,allowToolPlanning:true,
  },
};

export function aiFeatureExecutionProfile(
  feature:AiFeature,
  options:{liteMode?:boolean}={},
):AiFeatureExecutionProfile{
  const profile=PROFILES[feature];
  if(!profile)throw new Error(`Unknown MALENJO AI feature: ${feature}`);
  if(!options.liteMode)return {...profile};

  return {
    ...profile,
    preferredContextTokens:Math.max(
      profile.minimumContextTokens,
      Math.min(profile.preferredContextTokens,2048),
    ),
    maxOutputTokens:Math.min(profile.maxOutputTokens,feature==='classify'?160:256),
  };
}

export function minimumContextForAiFeature(feature:AiFeature):number{
  return aiFeatureExecutionProfile(feature).minimumContextTokens;
}

export function assertAiFeatureReady(
  feature:AiFeature,
  state:{sourceCount:number;toolPlanningEnabled:boolean},
):void{
  const profile=aiFeatureExecutionProfile(feature);
  if(profile.requiresSources&&state.sourceCount<1){
    throw new Error(`AI feature ${feature} requires at least one indexed source.`);
  }
  if(profile.allowToolPlanning&&!state.toolPlanningEnabled){
    throw new Error('AI tool planning is disabled by the application policy.');
  }
}
