import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const major=Number(process.versions.node.split('.')[0]);
if(!Number.isInteger(major)||major<24){
  console.error('PDF.js 6 uses Promise.try, which requires Node 24 or newer in Codespaces. Select Node 24 and rerun.');
  process.exit(2);
}
if(process.platform!=='linux'){
  console.error('Run this Codespaces execution suite in Linux, or view its GitHub CI artifacts.');
  process.exit(2);
}
const vitest=resolve(root,'node_modules/vitest/vitest.mjs');
if(!existsSync(vitest)){
  console.error('Run npm install --no-audit --no-fund before executing PDF workflows.');
  process.exit(2);
}
const out=resolve(root,'.build/pdf-codespaces-execution');
mkdirSync(out,{recursive:true});
console.log('Executing production PDF functions on real local files; evidence: '+out);
const task=spawnSync(process.execPath,[vitest,'run','tests/pdfCodespacesExecution.test.ts'],{
  cwd:root,stdio:'inherit',timeout:120000,
  env:{...process.env,MALENJO_PDF_EXECUTION:'1'},
});
if(task.error){console.error(task.error.message);process.exit(1);}
process.exit(task.status??1);
