import { describe, expect, it } from 'vitest';
import { buildRagIndex } from './rag';
import { hybridRetrieveCitations, semanticHitsFromVectorScores } from './hybridRetrieval';

describe('hybrid AI retrieval',()=>{
  const index=buildRagIndex([
    {id:'a',name:'Transformer.pdf',text:'Differential protection compares primary and secondary current around a transformer protected zone.'},
    {id:'b',name:'Maintenance.pdf',text:'Annual oil testing and quarterly thermography are maintenance activities.'},
    {id:'c',name:'Synonyms.pdf',text:'A Buchholz relay reacts to gas accumulation caused by internal transformer faults.'},
  ],false);

  it('keeps strong lexical matches',()=>{
    const result=hybridRetrieveCitations(index,'transformer differential protection');
    expect(result[0]?.sourceId).toBe('a');
  });

  it('can recover semantically relevant chunks that have weak lexical overlap',()=>{
    const target=index.chunks.find((chunk)=>chunk.sourceId==='c')!;
    const result=hybridRetrieveCitations(
      index,
      'device for incipient internal faults',
      [{chunkId:target.id,score:0.94}],
      {topK:2},
    );
    expect(result.some((item)=>item.sourceId==='c')).toBe(true);
  });

  it('honors notebook source filters and diversity bounds',()=>{
    const result=hybridRetrieveCitations(
      index,
      'transformer maintenance protection',
      index.chunks.map((chunk,index)=>({chunkId:chunk.id,score:1-index*0.1})),
      {sourceIds:new Set(['a','b']),topK:4,maxPerSource:1},
    );
    expect(result.every((item)=>['a','b'].includes(item.sourceId))).toBe(true);
    expect(result.filter((item)=>item.sourceId==='a')).toHaveLength(1);
    expect(result.filter((item)=>item.sourceId==='b')).toHaveLength(1);
  });

  it('normalizes vector provider results without accepting invalid scores',()=>{
    expect(semanticHitsFromVectorScores([
      {chunkId:'a',similarity:0.9},
      {chunkId:'b',similarity:Number.NaN},
      {chunkId:'c',similarity:0.1},
    ])).toEqual([{chunkId:'a',score:0.9}]);
  });
});
