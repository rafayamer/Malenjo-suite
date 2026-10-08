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
  upstreamRevision:string;
  upstreamUrl:string;
  providerUrl:string;
  reviewState:AiModelReviewState;
  installable:boolean;
  fineTunable:boolean;
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
  if(value.models.length!==1)throw new Error('MALENJO supports exactly one reviewed local model profile.');
  const profile=value.models[0]!;
  if(!profile.id||profile.id!==value.defaultProfileId)throw new Error('The sole AI model must be the default profile.');
  if(profile.provider!=='ollama')throw new Error('The reviewed MALENJO model must use the Ollama local provider.');
  if(profile.license!=='MIT')throw new Error('The reviewed MALENJO model must be MIT-licensed.');
  if(profile.reviewState!=='reviewed'||!profile.installable)throw new Error('The reviewed MALENJO model must be installable.');
  if(!profile.fineTunable)throw new Error('The reviewed MALENJO model must permit the fine-tuning workflow.');
  if(profile.approximateDownloadBytes<=0)throw new Error('The reviewed MALENJO model has an invalid size.');
  if(!/^[0-9a-f]{12,64}$/i.test(profile.expectedDigestPrefix))throw new Error('The reviewed MALENJO model has an invalid digest prefix.');
  if(!profile.upstreamRevision)throw new Error('The reviewed MALENJO model requires an upstream revision.');
  return value;
}

export const AI_MODEL_MANIFEST=validateManifest(manifest);
export const AI_MODEL_PROFILES=AI_MODEL_MANIFEST.models;
export const DEFAULT_AI_MODEL_PROFILE=AI_MODEL_PROFILES[0]!;

export function aiModelProfileById(id:string):AiModelProfile|undefined{
  return id===DEFAULT_AI_MODEL_PROFILE.id?DEFAULT_AI_MODEL_PROFILE:undefined;
}

export function aiModelProfileByTag(tag:string):AiModelProfile|undefined{
  return tag===DEFAULT_AI_MODEL_PROFILE.tag?DEFAULT_AI_MODEL_PROFILE:undefined;
}

export function approvedInstalledModels<T extends {name:string}>(models:T[]):T[]{
  return models.filter((model)=>model.name===DEFAULT_AI_MODEL_PROFILE.tag);
}

export function preferredInstalledModel(
  models:Array<{name:string}>,
  provider:'ollama'|'llama-cpp',
):string{
  if(provider!==DEFAULT_AI_MODEL_PROFILE.provider)return '';
  return models.some((model)=>model.name===DEFAULT_AI_MODEL_PROFILE.tag)
    ? DEFAULT_AI_MODEL_PROFILE.tag
    : '';
}

export function formatModelDownloadSize(bytes:number):string{
  if(bytes<1024**3)return `${Math.round(bytes/1024**2)} MB`;
  return `${(bytes/1024**3).toFixed(1)} GB`;
}
