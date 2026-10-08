import {describe,expect,it} from 'vitest';
import matrix from '../../../docs/pdf-stirling-parity-matrix.json';
import frontend from '../../../docs/pdf-stirling-pinned-frontend-routes.json';

describe('MALENJO PDF Stirling parity evidence inventory',()=>{
  it('enumerates 90 source-pinned operation IDs exactly once and in handoff order',()=>{
    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.catalogCount).toBe(90);
    expect(matrix.operations).toHaveLength(90);
    const ids=matrix.operations.map(item=>item.upstreamToolId);
    expect(new Set(ids).size).toBe(ids.length);
    for(let i=0;i<matrix.operations.length;i++){
      expect(matrix.operations[i].order).toBe(i+1);
      expect(ids[i]).toMatch(/^[a-zA-Z][a-zA-Z0-9-]*$/);
    }
  });

  it('never declares completed functionality without concrete offline Windows evidence',()=>{
    for(const operation of matrix.operations){
      const evidence=operation.evidence;
      const status=evidence.functionalStatus as string|null;
      const approved=['implemented','partial','unavailable','excluded-by-license',null];
      expect(approved).toContain(status);
      if(status==='implemented'){
        expect(operation.malenjo.implementationPaths.length).toBeGreaterThan(0);
        expect(operation.malenjo.frontendCommand).toBeTruthy();
        expect(operation.source.license).toBeTruthy();
        expect(operation.source.attributionVerified).toBe(true);
        expect(evidence.windowsOffline).toBe('verified');
        expect(evidence.runtimeResultVerified).toBe(true);
        expect(evidence.exportReopenVerified).toBe(true);
        expect(evidence.positiveTestIds.length).toBeGreaterThan(0);
        expect(evidence.negativeTestIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('credits only the 21 source-inspected native foundations as partial',()=>{
    expect(matrix.upstream.licensingAudited).toBe(false);
    expect(matrix.operations.filter(op=>op.evidence.functionalStatus==='partial')).toHaveLength(21);
    expect(matrix.operations.filter(op=>op.evidence.functionalStatus===null)).toHaveLength(69);
    expect(matrix.operations.some(op=>op.evidence.functionalStatus==='implemented')).toBe(false);
    for(const op of matrix.operations.filter(op=>op.evidence.functionalStatus==='partial')){
      expect(op.malenjo.implementationPaths.length).toBeGreaterThan(0);
      expect(op.evidence.positiveTestIds.length).toBeGreaterThan(0);
      expect(op.evidence.windowsOffline).toBe('unverified');
      expect(op.evidence.exportReopenVerified).toBe(false);
    }
    expect(matrix.auditSnapshot.localSourcePartialCount).toBe(21);
    expect(matrix.auditSnapshot.unverifiedSourceCount).toBe(69);
  });

  it('separates pinned API evidence from actual Windows functionality',()=>{
    expect(matrix.upstream.pinnedEndpointList.commit).toBe('25220cbdbde2d526cebf173b94357884e180b8c1');
    expect(matrix.upstream.pinnedEndpointList.endpointCount).toBe(62);
    expect(matrix.auditSnapshot.routeMatches).toBe(54);
    expect(matrix.auditSnapshot.notMatched).toBe(36);
    expect(matrix.auditSnapshot.unmappedUpstreamFixtureRoutes).toHaveLength(8);
    const routes=new Set<string>();
    for(const row of matrix.operations){
      expect(row.source.endpointTestPath).toBe('testing/endpoints.txt');
      const endpoint=row.source.upstreamEndpoint;
      if(endpoint){
        expect(routes.has(endpoint)).toBe(false);
        routes.add(endpoint);
        expect(endpoint.startsWith('/api/v1/')).toBe(true);
        expect(row.malenjo.providerCatalogMatchKey).toBe(endpoint);
      }
      expect(row.evidence.windowsOffline).toBe('unverified');
      expect(['partial',null]).toContain(row.evidence.functionalStatus);
    }
    expect(routes.size).toBe(54);
  });

  it('does not conflate upstream API route coverage with working user-facing operations',()=>{
    const matched=matrix.operations.filter(op=>op.source.endpointInPinnedFixture);
    expect(matched).toHaveLength(54);
    expect(matrix.operations.every(op=>op.evidence.functionalStatus!=='implemented')).toBe(true);
    expect(matrix.auditSnapshot.unmappedUpstreamFixtureRoutes).toHaveLength(8);
  });

  it('uses the exact pinned 105-URL core frontend registry as additional source evidence',()=>{
    expect(matrix.upstream.pinnedFrontendURLMap.urlCount).toBe(105);
    expect(matrix.upstream.pinnedFrontendURLMap.blobSha).toBe('67328c8ab22e775d544c8910387a37aec962628d');
    expect(matrix.upstream.pinnedFrontendCoreToolList.blobSha).toBe('de647e2b6e91c6bb9fb66735fd5db748adf75a88');
    expect(matrix.upstream.pinnedFrontendCoreToolList.coreToolCount).toBe(61);
    expect(Object.keys(frontend.routeToCoreToolId)).toHaveLength(105);
    expect(new Set(frontend.coreToolIds).size).toBe(61);
    const routes=frontend.routeToCoreToolId as Record<string,string>;
    const missingApi=matrix.operations.filter(x=>!x.source.upstreamEndpoint);
    expect(missingApi).toHaveLength(36);
    expect(missingApi.filter(x=>x.source.pinnedFrontendCoreToolId)).toHaveLength(22);
    expect(missingApi.filter(x=>!x.source.pinnedFrontendCoreToolId)).toHaveLength(14);
    for(const op of matrix.operations){
      if(op.source.pinnedFrontendCoreToolId){
        expect(op.source.pinnedFrontendRoute).toBeTruthy();
        expect(routes[op.source.pinnedFrontendRoute!]).toBe(op.source.pinnedFrontendCoreToolId);
        expect(frontend.coreToolIds).toContain(op.source.pinnedFrontendCoreToolId);
      }else expect(op.source.pinnedFrontendRoute).toBeNull();
      expect(op.evidence.windowsOffline).toBe('unverified');
      expect(op.evidence.functionalStatus).not.toBe('implemented');
    }
  });
});
