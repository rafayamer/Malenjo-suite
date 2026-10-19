export interface AiEvidenceClaim{
  text:string;
  sourceIds:string[];
}

export interface AiEvidenceDisagreement{
  topic:string;
  positions:Array<{text:string;sourceIds:string[]}>;
}

export interface AiReaderSynthesis{
  title:string;
  summary:string;
  summarySourceIds:string[];
  claims:AiEvidenceClaim[];
  disagreements:AiEvidenceDisagreement[];
  unknowns:string[];
}

export interface AiReaderEvidenceReport{
  sourceCount:number;
  citedSourceCount:number;
  claimCount:number;
  disagreementCount:number;
  uncitedClaims:number;
  coverage:number;
}

export const AI_READER_LIMITS={
  maxClaims:100,
  maxDisagreements:40,
  maxPositionsPerDisagreement:12,
  maxUnknowns:50,
  maxSourcesPerClaim:20,
} as const;

function clean(value:string,max=4_000):string{
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g,' ').trim().slice(0,max);
}

function citations(ids:unknown,allowed:Set<string>,required=true):string[]{
  if(!Array.isArray(ids)) {
    if(required)throw new Error('Evidence citations are required.');
    return [];
  }
  const normalized=Array.from(new Set(ids.map((id)=>clean(String(id),220)).filter(Boolean)));
  const invalid=normalized.filter((id)=>!allowed.has(id));
  if(invalid.length)throw new Error(`Reader output cited unauthorized source: ${invalid[0]}`);
  if(required&&!normalized.length)throw new Error('Evidence citations are required.');
  return normalized.slice(0,AI_READER_LIMITS.maxSourcesPerClaim);
}

export function validateAiReaderSynthesis(
  value:unknown,
  allowedSources:Set<string>,
):AiReaderSynthesis{
  if(!value||typeof value!=='object')throw new Error('Reader synthesis must be an object.');
  const input=value as Partial<AiReaderSynthesis>;
  const summary=clean(input.summary??'',12_000);
  if(!summary)throw new Error('Reader summary is required.');
  const summarySourceIds=citations(input.summarySourceIds,allowedSources,true);

  if(!Array.isArray(input.claims)||input.claims.length>AI_READER_LIMITS.maxClaims)throw new Error('Reader claim list is invalid.');
  const claims=input.claims.map((claim)=>{
    if(!claim||typeof claim!=='object')throw new Error('Reader claim is invalid.');
    const item=claim as AiEvidenceClaim;
    const text=clean(item.text,4_000);
    if(!text)throw new Error('Reader claim text is required.');
    return {text,sourceIds:citations(item.sourceIds,allowedSources,true)};
  });

  if(!Array.isArray(input.disagreements)||input.disagreements.length>AI_READER_LIMITS.maxDisagreements){
    throw new Error('Reader disagreement list is invalid.');
  }
  const disagreements=input.disagreements.map((raw)=>{
    if(!raw||typeof raw!=='object')throw new Error('Reader disagreement is invalid.');
    const item=raw as AiEvidenceDisagreement;
    const topic=clean(item.topic,500);
    if(!topic||!Array.isArray(item.positions)||item.positions.length<2||item.positions.length>AI_READER_LIMITS.maxPositionsPerDisagreement){
      throw new Error('Reader disagreement positions are invalid.');
    }
    return {
      topic,
      positions:item.positions.map((position)=>{
        const text=clean(position.text,4_000);
        if(!text)throw new Error('Reader disagreement position text is required.');
        return {text,sourceIds:citations(position.sourceIds,allowedSources,true)};
      }),
    };
  });

  const unknowns=Array.isArray(input.unknowns)
    ? input.unknowns.map((item)=>clean(String(item),2_000)).filter(Boolean).slice(0,AI_READER_LIMITS.maxUnknowns)
    : [];

  return {
    title:clean(input.title??'',500)||'Research synthesis',
    summary,
    summarySourceIds,
    claims,
    disagreements,
    unknowns,
  };
}

export function aiReaderEvidenceReport(
  synthesis:AiReaderSynthesis,
  allowedSources:Set<string>,
):AiReaderEvidenceReport{
  const cited=new Set<string>();
  synthesis.summarySourceIds.forEach((id)=>cited.add(id));
  let uncitedClaims=0;
  for(const claim of synthesis.claims){
    if(!claim.sourceIds.length)uncitedClaims+=1;
    claim.sourceIds.forEach((id)=>cited.add(id));
  }
  for(const disagreement of synthesis.disagreements){
    disagreement.positions.forEach((position)=>position.sourceIds.forEach((id)=>cited.add(id)));
  }
  return {
    sourceCount:allowedSources.size,
    citedSourceCount:cited.size,
    claimCount:synthesis.claims.length,
    disagreementCount:synthesis.disagreements.length,
    uncitedClaims,
    coverage:allowedSources.size?Math.round((cited.size/allowedSources.size)*1000)/1000:0,
  };
}

export function sourceComparisonMatrix(
  synthesis:AiReaderSynthesis,
  sourceIds:string[],
):Array<{topic:string;bySource:Record<string,string[]>}>{
  const rows:Array<{topic:string;bySource:Record<string,string[]>}>=[];
  for(const disagreement of synthesis.disagreements){
    const bySource:Record<string,string[]>={};
    sourceIds.forEach((id)=>{bySource[id]=[];});
    for(const position of disagreement.positions){
      for(const sourceId of position.sourceIds){
        if(bySource[sourceId])bySource[sourceId]!.push(position.text);
      }
    }
    rows.push({topic:disagreement.topic,bySource});
  }
  return rows;
}

export function aiReaderContract():string{
  return [
    'READER/RESEARCH RULES:',
    '- Cite every factual summary/claim with authorized source IDs.',
    '- Never invent a source ID or attribute one document\'s claim to another.',
    '- Put unsupported requested facts in unknowns instead of guessing.',
    '- Preserve source disagreements explicitly.',
    '- A comparison may synthesize, but it must keep per-source evidence traceable.',
  ].join('\n');
}
