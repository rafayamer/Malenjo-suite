import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const usage='Usage: npm run pdf:execute -- --operation rotate-pdf --input ./source.pdf --output ./rotated.pdf --page 1\nSupported local operations: rotate-pdf, remove-pages, rearrange-pages, extract-pages, merge-pdfs, scale-pages, booklet-imposition, split-by-size-or-count, split-pdf-by-chapters, pipeline, handleData, markdown-to-pdf, html-to-pdf, file-to-pdf, json-to-pdf, eml-to-pdf, pdf-to-json, pdf-to-xml, pdf-to-epub, pdf-to-markdown, pdf-to-html, pdf-to-csv, pdf-to-vector.\nOptional flags: --pages 1,3 --to 2 --paper A4 --second ./extra.pdf --plan \'[{"action":"rotate","pages":[1],"angle":90}]\'.';
if(process.argv.includes('--help')||process.argv.includes('-h')){
  console.log(usage);process.exit(0);
}
if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<24){
  console.error('This PDF CLI needs a Linux Codespace with Node 24 or newer.');process.exit(2);
}
const allowed=new Set(['operation','input','output','page','to','pages','second','paper','plan']);
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!key?.startsWith('--')||!allowed.has(key.slice(2))||!value){
    console.error(usage);process.exit(2);
  }
  const name=key.slice(2);
  if(Object.prototype.hasOwnProperty.call(args,name)){
    console.error('Duplicate PDF option: '+key);process.exit(2);
  }
  args[name]=value;
}
for(const name of ['input','output','operation']){
  if(!args[name]){console.error(usage);process.exit(2);}
}
for(const name of ['page','to']){
  if(args[name]!==undefined)args[name]=Number(args[name]);
}
const entry=resolve(root,'node_modules/vitest/vitest.mjs');
if(!existsSync(entry)){console.error('Install npm dependencies first.');process.exit(2);}
const proc=spawnSync(process.execPath,[entry,'run','src/suite/pdf/pdfCodespacesProcess.test.ts'],{
  cwd:root,stdio:'inherit',timeout:90000,
  env:{...process.env,MALENJO_PDF_SINGLE_COMMAND:JSON.stringify(args)},
});
if(proc.error){console.error(proc.error.message);process.exit(1);}
process.exit(proc.status??1);
