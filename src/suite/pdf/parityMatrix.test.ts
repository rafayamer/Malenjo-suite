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
      const approved=['implemented','partial','unavailable','excluded-by-license',null];
      expect(approved).toContain(evidence.functionalStatus);
      if(evidence.functionalStatus==='implemented'){
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
});
