/** Phase 3 evidence inventory. An automated test reference is NEVER a user sign-off. */
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessPdfRelease} from './pdf-release-readiness.mjs';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const MODULE_PATH='src/suite/modules/registry.ts';
const MATRIX_PATH='docs/pdf-stirling-parity-matrix.json';

export function inspectPhase3({registryText,matrix,root=ROOT}){
  const modules=Array.from(registryText.matchAll(
    /\{\s*id:'([^']+)',\s*name:'([^']+)',[^}\n]*?\bstatus:'(complete|partial|foundation|adapter)'[^}\n]*?\bgroup:'([^']+)'/g
  ),match=>({id:match[1],name:match[2],sourceStatus:match[3],group:match[4]}));
  if(modules.length!==22||new Set(modules.map(x=>x.id)).size!==22)
    throw new Error('Phase 3 audit requires exactly 22 unique registered modules.');
  const pdf=assessPdfRelease(matrix);
  const sourceTests=new Set();
  const operationEvidence=pdf.operations.map(operation=>{
    const row=matrix.operations.find(x=>x.upstreamToolId===operation.id);
    if(!row)throw new Error('Missing PDF matrix operation: '+operation.id);
    const references=[
      ...(row.evidence?.positiveTestIds??[]),
      ...(row.evidence?.negativeTestIds??[]),
    ];
    for(const test of references)sourceTests.add(test);
    const existingTests=references.filter(test=>test.startsWith('src/')&&
      existsSync(resolve(root,test)));
    const missingTests=references.filter(test=>!existsSync(resolve(root,test)));
    return {
      order:operation.order,id:operation.id,group:operation.group,
      sourceFunctionalStatus:operation.sourceStatus,accepted:operation.accepted,
      positiveTestReferences:row.evidence?.positiveTestIds?.length??0,
      negativeTestReferences:row.evidence?.negativeTestIds?.length??0,
      existingTestFiles:existingTests,
      missingTestFiles:missingTests,
      blockers:operation.blockers,
      // Only code/path-level references. They cannot establish correctness
      // without independent output, clean-install and manual sign-off.
      sourceTestEvidenceOnly:existingTests.length>0,
    };
  });
  const moduleEvidence=modules.map(module=>({
    ...module,
    navigationalSmokeRequired:true,
    functionalUserAcceptance:false,
    blockers:[
      ...(module.sourceStatus==='complete'?[]:['module not source-complete']),
      'real-user workflow acceptance not documented',
      'installed Windows offline acceptance not documented',
    ],
  }));
  const outstanding=new Map();
  for(const row of operationEvidence)for(const blocker of row.blockers){
    outstanding.set(blocker,(outstanding.get(blocker)??0)+1);
  }
  return {
    schemaVersion:1,
    gate:'Option B Phase 3 full functional verification',
    source: {modules:MODULE_PATH,pdfMatrix:MATRIX_PATH},
    summary:{
      registeredModules:modules.length,
      modulesMarkedSourceComplete:modules.filter(m=>m.sourceStatus==='complete').length,
      modulesFunctionallyAccepted:0,
      pdfCapabilities:operationEvidence.length,
      pdfCapabilitiesFullyAccepted:pdf.summary.accepted,
      pdfCapabilitiesNotAccepted:pdf.summary.notAccepted,
      pdfSourcePartial:pdf.summary.partial,
      referencedTestFiles:sourceTests.size,
      testReferencesCannotSubstituteForManualAcceptance:true,
      ready:moduleEvidence.every(x=>x.functionalUserAcceptance)&&pdf.ready,
    },
    missingEvidenceByGate:Object.fromEntries([...outstanding.entries()].sort((a,b)=>b[1]-a[1])),
    modules:moduleEvidence,pdfOperations:operationEvidence,
  };
}
export function inspectRepositoryPhase3(){
  return inspectPhase3({
    registryText:readFileSync(resolve(ROOT,MODULE_PATH),'utf8'),
    matrix:JSON.parse(readFileSync(resolve(ROOT,MATRIX_PATH),'utf8')),
  });
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const audit=inspectRepositoryPhase3();
  if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(audit,null,2)+'\n');
  else{
    console.log('PHASE3 SOURCE AUDIT: '+audit.summary.registeredModules+
      ' registered modules, '+audit.summary.modulesMarkedSourceComplete+
      ' source-marked complete, '+audit.summary.modulesFunctionallyAccepted+
      ' independently accepted');
    console.log('PDF RELEASE GATE: '+audit.summary.pdfCapabilitiesFullyAccepted+
      '/'+audit.summary.pdfCapabilities+' fully accepted');
    for(const [why,count] of Object.entries(audit.missingEvidenceByGate))
      console.log('  '+count+' PDF requirements blocked: '+why);
  }
  if(process.argv.includes('--strict')&&!audit.summary.ready)process.exitCode=1;
}
