import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {inspectRepositoryPhase3,inspectPhase3} from './phase3-functional-audit.mjs';
const audit=inspectRepositoryPhase3();
test('all 22 registered modules are accounted for by the acceptance inventory',()=>{
  assert.equal(audit.modules.length,22);
  assert.equal(new Set(audit.modules.map(x=>x.id)).size,22);
  assert.equal(audit.summary.registeredModules,22);
  assert.ok(audit.modules.every(m=>m.blockers.length>0));
});
test('all 90 PDF operations require strict evidence before release acceptance',()=>{
  assert.equal(audit.pdfOperations.length,90);
  assert.equal(new Set(audit.pdfOperations.map(x=>x.id)).size,90);
  assert.equal(audit.summary.pdfCapabilitiesNotAccepted+
    audit.summary.pdfCapabilitiesFullyAccepted,90);
  assert.ok(audit.pdfOperations.every(row=>
    row.accepted === (row.blockers.length===0)));
});
test('source tests and mock endpoints never silently count as human acceptance',()=>{
  assert.equal(audit.summary.modulesFunctionallyAccepted,0);
  assert.equal(audit.summary.testReferencesCannotSubstituteForManualAcceptance,true);
  assert.equal(audit.summary.pdfCapabilitiesFullyAccepted,0);
  assert.equal(audit.summary.ready,false);
});
test('the inventory refuses truncated, missing or duplicated module records',()=>{
  const source=readFileSync(resolve('src/suite/modules/registry.ts'),'utf8');
  const matrix=JSON.parse(readFileSync(resolve('docs/pdf-stirling-parity-matrix.json'),'utf8'));
  assert.throws(()=>inspectPhase3({registryText:source.replace("id:'home'","id:'files'"),matrix}),
    /unique registered modules/);
  assert.throws(()=>inspectPhase3({registryText:'export const modules=[];',matrix}),
    /exactly 22/);
  assert.throws(()=>inspectPhase3({registryText:source,matrix:{...matrix,catalogCount:89}}),
    /90-operation inventory/);
});
