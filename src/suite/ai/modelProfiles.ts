import manifestJson from '../../../third_party/models/MODEL_LICENSES.json';

export type AiModelResourceClass='ultralite'|'lite'|'standard';
export type AiModelReviewState='reviewed'|'candidate';

export interface AiModelProfile{
  id:string;
  provider:'ollama'|'llama-cpp';
  tag:string;
  displayName:string;
  resourceClass:AiModelResourceClass;
  approximateDownloadBytes:number;
  expectedDigestPrefix:string;
  license:string;
  upstreamModel:string;
  upstreamUrl:string;
  providerUrl:string;
  reviewState:AiModelReviewState;
  installable:boolean;
  notes:string;
}

interface AiModelManifest{
  schemaVersion:number;
  reviewedAt:string;
  purpose:string;
  defaultProfileId:string;
  models:AiModelProfile[];
}

const manifest=manifestJson as AiModelManifest;

function validateManifest(value:AiModelManifest):AiModelManifest{
  if(value.schemaVersion!==2)throw new Error('Unsupported MALENJO AI model manifest schema.');
  const ids=new Set<string>();
  const tags=new Set<string>();
  for(const profile of value.models){
    if(!profile.id||ids.has(profile.id))throw new Error('AI model profile IDs must be unique and non-empty.');
    if(!profile.tag||tags.has(profile.tag))throw new Error('AI model tags must be unique and non-empty.');
    if(profile.approximateDownloadBytes<=0)throw new Error(`AI model profile ${profile.id} has an invalid size.`);
    if(!/^[0-9a-f]{12,64}$/i.test(profile.expectedDigestPrefix))throw new Error(`AI model profile ${profile.id} has an invalid digest prefix.`);
    if(profile.installable&&profile.reviewState!=='reviewed')throw new Error(`AI model profile ${profile.id} cannot be installable before review.`);
    ids.add(profile.id);
    tags.add(profile.tag);
  }
  if(!ids.has(value.defaultProfileId))throw new Error('Default AI model profile is missing.');
  return value;
}

export const AI_MODEL_MANIFEST=validateManifest(manifest);
export const AI_MODEL_PROFILES=AI_MODEL_MANIFEST.models;
export const DEFAULT_AI_MODEL_PROFILE=AI_MODEL_PROFILES.find((profile)=>profile.id===AI_MODEL_MANIFEST.defaultProfileId)!;

export function aiModelProfileById(id:string):AiModelProfile|undefined{
  return AI_MODEL_PROFILES.find((profile)=>profile.id===id);
}

export function aiModelProfileByTag(tag:string):AiModelProfile|undefined{
  return AI_MODEL_PROFILES.find((profile)=>profile.tag===tag);
}

export function preferredInstalledModel(
  models:Array<{name:string}>,
  provider:'ollama'|'llama-cpp',
):string{
  const installed=new Set(models.map((model)=>model.name));
  const qualityRank:Record<AiModelResourceClass,number>={ultralite:0,lite:1,standard:2};
  const preferred=AI_MODEL_PROFILES
    .filter((profile)=>
      profile.provider===provider&&
      profile.installable&&
      profile.reviewState==='reviewed'&&
      installed.has(profile.tag),
    )
    .sort((left,right)=>{
      const mitDelta=Number(right.license==='MIT')-Number(left.license==='MIT');
      if(mitDelta)return mitDelta;
      return qualityRank[right.resourceClass]-qualityRank[left.resourceClass];
    })[0];
  return preferred?.tag??models[0]?.name??'';
}

export function formatModelDownloadSize(bytes:number):string{
  if(bytes<1024**3)return `${Math.round(bytes/1024**2)} MB`;
  return `${(bytes/1024**3).toFixed(1)} GB`;
}
