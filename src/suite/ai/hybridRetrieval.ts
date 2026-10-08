import { RAG_LIMITS, tokenize, type Citation, type RagChunk, type RagIndex } from './rag';

export interface SemanticRetrievalHit{
  chunkId:string;
  score:number;
}

export interface HybridRetrievalOptions{
  topK?:number;
  sourceIds?:Set<string>;
  lexicalWeight?:number;
  semanticWeight?:number;
  maxPerSource?:number;
}

interface RankedChunk{
  chunk:RagChunk;
  rank:number;
  rawScore:number;
}

function clampWeight(value:number|undefined,fallback:number):number{
  if(value===undefined||!Number.isFinite(value))return fallback;
  return Math.max(0,Math.min(1,value));
}

function lexicalScore(chunks:RagChunk[],query:string):RankedChunk[]{
  const terms=Array.from(new Set(tokenize(query)));
  if(!terms.length)return [];

  const docFreq=new Map<string,number>();
  for(const term of terms){
    let count=0;
    for(const chunk of chunks){
      if(chunk.tokens.includes(term))count+=1;
    }
    docFreq.set(term,count);
  }

  const averageLength=chunks.length
    ? chunks.reduce((sum,chunk)=>sum+chunk.tokens.length,0)/chunks.length
    : 1;
  const k1=1.2;
  const b=0.75;

  return chunks
    .map((chunk)=>{
      const frequencies=new Map<string,number>();
      for(const token of chunk.tokens)frequencies.set(token,(frequencies.get(token)??0)+1);
      let score=0;
      for(const term of terms){
        const tf=frequencies.get(term)??0;
        if(!tf)continue;
        const df=docFreq.get(term)??0;
        const idf=Math.log(1+(chunks.length-df+0.5)/(df+0.5));
        const lengthNorm=1-b+b*(chunk.tokens.length/Math.max(1,averageLength));
        score+=idf*((tf*(k1+1))/(tf+k1*lengthNorm));
      }
      return {chunk,score};
    })
    .filter((item)=>item.score>0)
    .sort((a,b)=>b.score-a.score)
    .map((item,index)=>({chunk:item.chunk,rank:index+1,rawScore:item.score}));
}

function semanticScore(
  chunks:RagChunk[],
  hits:SemanticRetrievalHit[],
):RankedChunk[]{
  const byId=new Map(chunks.map((chunk)=>[chunk.id,chunk]));
  return hits
    .filter((hit)=>Number.isFinite(hit.score)&&hit.score>0&&byId.has(hit.chunkId))
    .sort((a,b)=>b.score-a.score)
    .map((hit,index)=>({
      chunk:byId.get(hit.chunkId)!,
      rank:index+1,
      rawScore:hit.score,
    }));
}

export function hybridRetrieveCitations(
  index:RagIndex,
  query:string,
  semanticHits:SemanticRetrievalHit[]=[],
  options:HybridRetrievalOptions={},
):Citation[]{
  const requested=Math.max(1,Math.min(
    options.topK??(index.liteMode?RAG_LIMITS.lite.topK:RAG_LIMITS.normal.topK),
    12,
  ));
  const maxPerSource=Math.max(1,Math.min(options.maxPerSource??3,requested));
  const sourceFiltered=options.sourceIds
    ? index.chunks.filter((chunk)=>options.sourceIds!.has(chunk.sourceId))
    : index.chunks;
  if(!sourceFiltered.length)return [];

  const lexicalWeight=clampWeight(options.lexicalWeight,0.55);
  const semanticWeight=clampWeight(options.semanticWeight,0.45);
  const lexical=lexicalScore(sourceFiltered,query).slice(0,80);
  const semantic=semanticScore(sourceFiltered,semanticHits).slice(0,80);
  if(!lexical.length&&!semantic.length)return [];

  // Reciprocal-rank fusion is deliberately rank-based so providers with very
  // different raw similarity scales can be combined without pretending the
  // scores are directly comparable.
  const rrfK=60;
  const fused=new Map<string,{chunk:RagChunk;score:number;lexicalRank?:number;semanticRank?:number}>();

  for(const item of lexical){
    const current=fused.get(item.chunk.id)??{chunk:item.chunk,score:0};
    current.score+=lexicalWeight/(rrfK+item.rank);
    current.lexicalRank=item.rank;
    fused.set(item.chunk.id,current);
  }
  for(const item of semantic){
    const current=fused.get(item.chunk.id)??{chunk:item.chunk,score:0};
    current.score+=semanticWeight/(rrfK+item.rank);
    current.semanticRank=item.rank;
    fused.set(item.chunk.id,current);
  }

  const ranked=Array.from(fused.values())
    .sort((a,b)=>{
      if(b.score!==a.score)return b.score-a.score;
      const aDual=Number(a.lexicalRank!==undefined&&a.semanticRank!==undefined);
      const bDual=Number(b.lexicalRank!==undefined&&b.semanticRank!==undefined);
      if(bDual!==aDual)return bDual-aDual;
      return a.chunk.id.localeCompare(b.chunk.id);
    });

  const selected:typeof ranked=[];
  const perSource=new Map<string,number>();
  for(const item of ranked){
    const used=perSource.get(item.chunk.sourceId)??0;
    if(used>=maxPerSource)continue;
    selected.push(item);
    perSource.set(item.chunk.sourceId,used+1);
    if(selected.length>=requested)break;
  }

  return selected.map((item,index)=>({
    id:`S${index+1}`,
    sourceId:item.chunk.sourceId,
    sourceName:item.chunk.sourceName,
    chunkId:item.chunk.id,
    excerpt:item.chunk.text.slice(0,1600),
    score:Math.round(item.score*1_000_000)/1_000_000,
  }));
}

export function semanticHitsFromVectorScores(
  scores:Array<{chunkId:string;similarity:number}>,
  minimumSimilarity=0.15,
):SemanticRetrievalHit[]{
  return scores
    .filter((item)=>Number.isFinite(item.similarity)&&item.similarity>=minimumSimilarity)
    .sort((a,b)=>b.similarity-a.similarity)
    .map((item)=>({chunkId:item.chunkId,score:item.similarity}));
}
