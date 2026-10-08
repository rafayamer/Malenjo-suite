import {describe,expect,it} from 'vitest';
import matrix from '../../../docs/pdf-stirling-parity-matrix.json';

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

  it('does not mistakenly claim completion of the unverified baseline',()=>{
    expect(matrix.upstream.licensingAudited).toBe(false);
    expect(matrix.operations.every(op=>op.evidence.functionalStatus===null)).toBe(true);
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
      expect(row.evidence.functionalStatus).toBeNull();
    }
    expect(routes.size).toBe(54);
  });
});
