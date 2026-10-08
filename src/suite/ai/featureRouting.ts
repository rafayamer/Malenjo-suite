export type AiFeature='document-chat'|'summarize'|'extract'|'classify'|'rewrite';
export type AiResourceClass='ultralite'|'lite'|'standard';

export interface AiRoutingCandidate{
  id:string;
  provider:'ollama'|'llama-cpp';
  license:string;
  resourceClass:AiResourceClass;
  maxContextTokens:number;
  reviewState:'reviewed'|'candidate';
  installable:boolean;
  features?:AiFeature[];
}

export interface AiRoutingPreference{
  preferMit?:boolean;
  preferLite?:boolean;
}

const FEATURE_CONTEXT:Record<AiFeature,number>={
  'document-chat':2048,
  summarize:4096,
  extract:4096,
  classify:2048,
  rewrite:2048,
};

const RESOURCE_RANK:Record<AiResourceClass,number>={ultralite:0,lite:1,standard:2};

export function selectAiModelForFeature(
  feature:AiFeature,
  candidates:AiRoutingCandidate[],
  preference:AiRoutingPreference={preferMit:true,preferLite:true},
):AiRoutingCandidate|null{
  const eligible=candidates.filter((candidate)=>
    candidate.reviewState==='reviewed'
    &&candidate.installable
    &&candidate.maxContextTokens>=FEATURE_CONTEXT[feature]
    &&(!candidate.features||candidate.features.includes(feature)),
  );
  eligible.sort((left,right)=>{
    if(preference.preferMit){
      const licenseDelta=Number(right.license==='MIT')-Number(left.license==='MIT');
      if(licenseDelta)return licenseDelta;
    }
    if(preference.preferLite){
      const resourceDelta=RESOURCE_RANK[left.resourceClass]-RESOURCE_RANK[right.resourceClass];
      if(resourceDelta)return resourceDelta;
    }
    return left.id.localeCompare(right.id);
  });
  return eligible[0]??null;
}

export function minimumContextForAiFeature(feature:AiFeature):number{
  return FEATURE_CONTEXT[feature];
}
