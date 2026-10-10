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
        const manual=evidence as typeof evidence&{manualWindowsAcceptance?:boolean;acceptedBuildSha?:string};
        expect(manual.manualWindowsAcceptance).toBe(true);
        expect(manual.acceptedBuildSha).toMatch(/^[a-f0-9]{40}$/);
      }
    }
  });

  it('tracks all audited native foundations without locking the project at zero accepted',()=>{
    expect(typeof matrix.upstream.licensingAudited).toBe('boolean');
    expect(matrix.operations.filter(op=>op.evidence.functionalStatus==='partial')).toHaveLength(matrix.auditSnapshot.localSourcePartialCount);
    expect(matrix.operations.filter(op=>op.evidence.functionalStatus===null)).toHaveLength(matrix.auditSnapshot.unverifiedSourceCount);
    expect(matrix.auditSnapshot.localSourcePartialCount+matrix.auditSnapshot.unverifiedSourceCount).toBeLessThanOrEqual(90);
    for(const op of matrix.operations.filter(op=>op.evidence.functionalStatus==='partial')){
      expect(op.malenjo.implementationPaths.length).toBeGreaterThan(0);
      expect(op.evidence.positiveTestIds.length).toBeGreaterThan(0);
      expect(['verified','unverified','unavailable','unsupported']).toContain(op.evidence.windowsOffline);
      expect(typeof op.evidence.exportReopenVerified).toBe('boolean');
    }
    expect(matrix.auditSnapshot.localSourcePartialCount).toBe(matrix.operations.filter(op=>op.evidence.functionalStatus==='partial').length);
    expect(matrix.auditSnapshot.unverifiedSourceCount).toBe(matrix.operations.filter(op=>op.evidence.functionalStatus===null).length);
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
      expect(['verified','unverified','unavailable','unsupported']).toContain(row.evidence.windowsOffline);
      expect(['implemented','partial','unavailable','excluded-by-license',null]).toContain(row.evidence.functionalStatus);
    }
    expect(routes.size).toBe(54);
  });

  it('does not conflate upstream API route coverage with working user-facing operations',()=>{
    const matched=matrix.operations.filter(op=>op.source.endpointInPinnedFixture);
    expect(matched).toHaveLength(54);
    expect(matrix.operations.every(op=>['implemented','partial','unavailable','excluded-by-license',null].includes(op.evidence.functionalStatus))).toBe(true);
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
      expect(['verified','unverified','unavailable','unsupported']).toContain(op.evidence.windowsOffline);
      expect(['implemented','partial','unavailable','excluded-by-license',null]).toContain(op.evidence.functionalStatus);
    }
  });

  it('classifies every source item without mistaking controller/configuration entries for acceptance',()=>{
    expect(matrix.auditSnapshot.pinnedControllerOnlyRouteMatches).toBe(8);
    expect(matrix.auditSnapshot.pinnedConfigurationOnlyMatches).toBe(6);
    expect(matrix.auditSnapshot.pendingFurtherUpstreamSourceClassification).toBe(0);
    const categories={fixture:0,controller:0,frontend:0,configuration:0,unknown:0};
    for(const item of matrix.operations){
      if(item.source.upstreamEndpoint)categories.fixture++;
      else if(item.source.pinnedControllerEndpoint){
        categories.controller++;
        expect(item.source.pinnedControllerPath).toContain('app/core/src/main/java/');
        expect(item.source.pinnedControllerBlobSha).toMatch(/^[a-f0-9]{40}$/);
      }else if(item.source.pinnedFrontendCoreToolId)categories.frontend++;
      else if(item.source.pinnedConfigurationOnly){
        categories.configuration++;
        expect(item.source.pinnedConfigurationBlobSha).toBe('8aaeba37e8dee12d99c4fa0ceda10d141a44ba7e');
        expect(item.source.pinnedConfigurationGroups.length).toBeGreaterThan(0);
      }else categories.unknown++;
      expect(['verified','unverified','unavailable','unsupported']).toContain(item.evidence.windowsOffline);
      expect(['implemented','partial','unavailable','excluded-by-license',null]).toContain(item.evidence.functionalStatus);
    }
    expect(categories).toEqual({fixture:54,controller:8,frontend:22,configuration:6,unknown:0});
    expect(matrix.operations.filter(item=>item.evidence.functionalStatus==='partial')).toHaveLength(matrix.auditSnapshot.localSourcePartialCount);
  });
});
