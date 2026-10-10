import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const matrixPath=resolve(root,'docs/pdf-stirling-parity-matrix.json');

export const FULL_ACCEPTANCE_GATES=[
  'implemented source audited',
  'UI command bound to feature',
  'licensing and attribution approved',
  'positive and negative test fixtures',
  'resource budgets documented',
  'actual offline Windows execution',
  'provider response verified',
  'saved output reopened or equivalent tested',
  'manual Windows release sign-off at tested build',
];
export function assessPdfOperation(row){
  const blockers=[];
  const source=row.source||{},malenjo=row.malenjo||{},evidence=row.evidence||{};
  if(evidence.functionalStatus!=='implemented')blockers.push('implemented source audited');
  if(!Array.isArray(malenjo.implementationPaths)||!malenjo.implementationPaths.length)blockers.push('local implementation source');
  if(!malenjo.frontendCommand)blockers.push('UI command bound to feature');
  if(!source.license||source.attributionVerified!==true)blockers.push('licensing and attribution approved');
  if(!Array.isArray(evidence.positiveTestIds)||!evidence.positiveTestIds.length||
     !Array.isArray(evidence.negativeTestIds)||!evidence.negativeTestIds.length||
     !Array.isArray(evidence.fixtures)||!evidence.fixtures.length){
    blockers.push('positive and negative test fixtures');
  }
  if(!evidence.limits)blockers.push('resource budgets documented');
  if(evidence.windowsOffline!=='verified')blockers.push('actual offline Windows execution');
  if(evidence.runtimeResultVerified!==true)blockers.push('provider response verified');
  if(evidence.exportReopenVerified!==true)blockers.push('saved output reopened or equivalent tested');
  // The 90-operation release gate is stricter than ordinary CI: a headless
  // Windows provider response cannot stand in for a human-accepted installer.
  if(evidence.manualWindowsAcceptance!==true||
     !/^[a-f0-9]{40}$/.test(evidence.acceptedBuildSha??'')){
    blockers.push('manual Windows release sign-off at tested build');
  }
  return {
    order:row.order,id:row.upstreamToolId,group:row.group,
    sourceStatus:evidence.functionalStatus??'unaudited',
    sourceRoute:source.upstreamEndpoint??source.pinnedControllerEndpoint??null,
    sourceKind:source.upstreamEndpoint?'backend-api':source.pinnedControllerEndpoint?'controller-only':
      source.pinnedFrontendCoreToolId?'frontend-only':source.pinnedConfigurationOnly?'configuration-only':'unknown',
    accepted:blockers.length===0,
    blockers,
  };
}
export function assessPdfRelease(matrix){
  if(matrix.catalogCount!==90||!Array.isArray(matrix.operations)||matrix.operations.length!==90){
    throw new Error('PDF parity release gate requires the complete 90-operation inventory.');
  }
  const operations=matrix.operations.map(assessPdfOperation);
  const ids=operations.map(row=>row.id);
  if(new Set(ids).size!==90)throw new Error('Duplicate PDF parity identifiers.');
  const summary={
    total:90,
    accepted:operations.filter(x=>x.accepted).length,
    partial:operations.filter(x=>x.sourceStatus==='partial').length,
    unaudited:operations.filter(x=>x.sourceStatus==='unaudited').length,
    notAccepted:operations.filter(x=>!x.accepted).length,
    byGroup:Object.fromEntries([...new Set(operations.map(x=>x.group))].map(group=>[
      group,{
        total:operations.filter(x=>x.group===group).length,
        accepted:operations.filter(x=>x.group===group&&x.accepted).length,
      },
    ])),
  };
  return {schemaVersion:1,gate:'MALENJO full PDF parity release',
    baselineCommit:matrix.upstream?.commit??matrix.generatedFrom,
    ready:summary.accepted===90,summary,operations};
}
const isCLI=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isCLI){
  const report=assessPdfRelease(JSON.parse(readFileSync(matrixPath,'utf8')));
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    console.log('MALENJO PDF release gate: '+(report.ready?'PASS':'BLOCKED'));
    console.log('Accepted '+report.summary.accepted+'/'+report.summary.total
      +'; partial '+report.summary.partial+'; unaudited '+report.summary.unaudited);
    for(const row of report.operations.filter(x=>!x.accepted)){
      console.log(row.order+'. '+row.id+' ['+row.sourceKind+'] — '+row.blockers.join('; '));
    }
  }
  if(process.argv.includes('--strict')&&!report.ready)process.exitCode=1;
}
