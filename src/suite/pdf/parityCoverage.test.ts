import {describe,expect,it} from 'vitest';
import type {PdfProviderOperation} from './backend';
import {computePdfParityCoverage} from './parityCoverage';

function mockOperation(
  id:string,path:string,available:boolean,
):PdfProviderOperation{
  return {
    id,path,method:'POST',summary:id,description:'',
    tags:[],fields:[],category:'organize',
    capability:{
      available,implementation:'Stirling open core',providerId:'stirling-core',
      legalReference:'docs/audits/PDF-PROVIDER-MATRIX-PASS2.md',
    },
  };
}

describe('runtime evidence for all 90 Stirling parity items',()=>{
  it('shows all handoff operations while the runtime provider is stopped',()=>{
    const coverage=computePdfParityCoverage([],false);
    expect(coverage.total).toBe(90);
    expect(coverage.rows).toHaveLength(90);
    expect(coverage.upstreamFixtureMatched).toBe(54);
    expect(coverage.liveRoutes).toBe(0);
    expect(coverage.providerEnabled).toBe(0);
    expect(coverage.functionallyVerified).toBe(0);
    expect(coverage.rows.find(item=>item.id==='merge-pdfs')?.state).toBe('provider-not-loaded');
    expect(coverage.rows.find(item=>item.id==='pdf-to-epub')?.state).toBe('not-in-pinned-endpoint-fixture');
  });

  it('matches only exact provider paths and never promotes functionality',()=>{
    const operations=[
      mockOperation('mergePDF','/api/v1/general/merge-pdfs',true),
      mockOperation('repairPDF','/api/v1/misc/repair',false),
      mockOperation('nonsense','/api/v1/general/merge-pdfs-malicious',true),
    ];
    const coverage=computePdfParityCoverage(operations,true);
    expect(coverage.liveRoutes).toBe(2);
    expect(coverage.providerEnabled).toBe(1);
    expect(coverage.functionallyVerified).toBe(0);
    const merge=coverage.rows.find(item=>item.id==='merge-pdfs')!;
    expect(merge.operation?.id).toBe('mergePDF');
    expect(merge.state).toBe('provider-reports-available');
    expect(merge.functionallyVerified).toBe(false);
    expect(coverage.rows.find(item=>item.id==='repair')?.state).toBe('provider-disabled');
    expect(coverage.rows.find(item=>item.id==='rotate-pdf')?.state).toBe('not-in-live-openapi');
  });

  it('never conflates a missing upstream fixture entry with disabled Windows support',()=>{
    const coverage=computePdfParityCoverage([],true);
    expect(coverage.rows.filter(item=>item.state==='not-in-pinned-endpoint-fixture')).toHaveLength(36);
    expect(coverage.rows.filter(item=>item.state==='not-in-live-openapi')).toHaveLength(54);
    expect(coverage.rows.every(item=>!item.functionallyVerified)).toBe(true);
  });
});
