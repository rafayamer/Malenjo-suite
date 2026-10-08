import type { Citation } from './rag';

export interface AiAnswerQualityReport{
  citedIds:string[];
  invalidCitationIds:string[];
  duplicateCitationIds:string[];
  factualSentenceCount:number;
  citedFactualSentenceCount:number;
  citationCoverage:number;
  insufficientEvidenceAcknowledged:boolean;
  passed:boolean;
  reasons:string[];
}

const CITATION=/\[S(\d+)\]/g;

function sentences(value:string):string[]{
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence)=>sentence.trim())
    .filter(Boolean);
}

function citationIds(value:string):string[]{
  const ids:string[]=[];
  for(const match of value.matchAll(CITATION))ids.push(`S${match[1]}`);
  return ids;
}

function looksFactual(sentence:string):boolean{
  if(sentence.length<18)return false;
  if(/^(?:i |we |would you|do you want|please |generation stopped)/i.test(sentence))return false;
  if(/\?$/.test(sentence))return false;
  return /\b(?:is|are|was|were|has|have|uses|requires|recommends|states|shows|means|contains|indicates|specifies|reports|found|measured|according)\b/i.test(sentence);
}

export function verifyAiAnswerQuality(
  answer:string,
  citations:Citation[],
  options:{sourcesWereAvailable:boolean;minimumCoverage?:number}={
    sourcesWereAvailable:false,
  },
):AiAnswerQualityReport{
  const allowed=new Set(citations.map((citation)=>citation.id));
  const citedIds=citationIds(answer);
  const unique=new Set<string>();
  const duplicateCitationIds:string[]=[];
  for(const id of citedIds){
    if(unique.has(id)&&!duplicateCitationIds.includes(id))duplicateCitationIds.push(id);
    unique.add(id);
  }
  const invalidCitationIds=Array.from(unique).filter((id)=>!allowed.has(id));

  const factual=sentences(answer).filter(looksFactual);
  const citedFactual=factual.filter((sentence)=>citationIds(sentence).some((id)=>allowed.has(id)));
  const citationCoverage=factual.length?citedFactual.length/factual.length:1;
  const insufficientEvidenceAcknowledged=/\b(?:insufficient|not enough information|sources do not|source does not|not stated|cannot determine|unsupported by the supplied)\b/i.test(answer);
  const minimum=options.minimumCoverage??0.7;
  const reasons:string[]=[];

  if(invalidCitationIds.length)reasons.push('Answer contains citation IDs that were not supplied by retrieval.');
  if(options.sourcesWereAvailable&&factual.length&&citationCoverage<minimum&&!insufficientEvidenceAcknowledged){
    reasons.push('Source-grounded factual sentences do not meet the citation coverage threshold.');
  }
  if(options.sourcesWereAvailable&&!citedIds.length&&!insufficientEvidenceAcknowledged){
    reasons.push('Sources were available but the answer contains no source citation or insufficiency acknowledgement.');
  }

  return {
    citedIds:Array.from(unique),
    invalidCitationIds,
    duplicateCitationIds,
    factualSentenceCount:factual.length,
    citedFactualSentenceCount:citedFactual.length,
    citationCoverage:Math.round(citationCoverage*1000)/1000,
    insufficientEvidenceAcknowledged,
    passed:reasons.length===0,
    reasons,
  };
}

export function shouldRegenerateAiAnswer(report:AiAnswerQualityReport):boolean{
  return !report.passed&&(
    report.invalidCitationIds.length>0||
    report.citationCoverage<0.5
  );
}

export function aiGroundingRepairInstruction(report:AiAnswerQualityReport):string{
  const issues=report.reasons.length?report.reasons.join(' '):'No grounding defect was detected.';
  return [
    'GROUNDING REPAIR:',
    issues,
    'Rewrite only from the supplied source passages. Use only the supplied [S#] citation IDs. If evidence is insufficient, say so instead of guessing.',
  ].join('\n');
}
