import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessPdfOperation,assessPdfRelease} from './pdf-release-readiness.mjs';

const matrix=JSON.parse(readFileSync(new URL('../docs/pdf-stirling-parity-matrix.json',import.meta.url),'utf8'));

test('every pinned PDF requirement is audited for release gates without false acceptance',()=>{
  const report=assessPdfRelease(matrix);
  assert.equal(report.summary.total,90);
  assert.equal(report.operations.length,90);
  assert.equal(report.summary.notAccepted,90);
  assert.equal(report.summary.accepted,0);
  assert.equal(report.summary.partial,27);
  assert.equal(report.summary.unaudited,63);
  assert.equal(report.ready,false);
  assert.ok(report.operations.every(x=>x.blockers.includes('actual offline Windows execution')));
});
test('requires license, UI, positive and negative tests, saved output and manual acceptance',()=>{
  const row=structuredClone(matrix.operations[0]);
  row.evidence.functionalStatus='implemented';
  row.malenjo.frontendCommand='merge';
  row.source.license='MIT';
  row.source.attributionVerified=true;
  row.evidence.positiveTestIds=['fixtures/merge-positive'];
  row.evidence.negativeTestIds=['fixtures/merge-negative'];
  row.evidence.fixtures=['fixtures/two-pdfs'];
  row.evidence.limits={inputBytes:1024};
  row.evidence.windowsOffline='verified';
  row.evidence.runtimeResultVerified=true;
  row.evidence.exportReopenVerified=true;
  row.evidence.manualWindowsAcceptance=true;
  row.evidence.acceptedBuildSha='a'.repeat(40);
  const passed=assessPdfOperation(row);
  assert.equal(passed.accepted,true);
  assert.deepEqual(passed.blockers,[]);
  row.evidence.manualWindowsAcceptance=false;
  assert.ok(assessPdfOperation(row).blockers.includes('manual Windows release sign-off at tested build'));
  row.evidence.manualWindowsAcceptance=true;
  row.source.license=null;
  assert.ok(assessPdfOperation(row).blockers.includes('licensing and attribution approved'));
});
test('incomplete inventory and duplicate feature identifiers fail closed',()=>{
  assert.throws(()=>assessPdfRelease({...matrix,operations:[]}),/complete/);
  const duplicate=structuredClone(matrix);
  duplicate.operations[1].upstreamToolId=duplicate.operations[0].upstreamToolId;
  assert.throws(()=>assessPdfRelease(duplicate),/Duplicate/);
});
