/**
 * Genuine qpdf AES-256 permission-controlled PDF copy for Linux Codespaces.
 * External qpdf is optional: install the distro package explicitly.
 * Passwords come only from environment variables, then qpdf @- on stdin.
 * No password is ever included in an OS-visible child argv.
 *
 * Usage: MALENJO_QPDF_OWNER_PASSWORD=... npm run pdf:qpdf -- --input a.pdf --output b.pdf
 */
import {spawnSync} from 'node:child_process';
import {
  chmodSync,existsSync,lstatSync,mkdtempSync,readFileSync,realpathSync,
  rmSync,writeFileSync,
} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {PDFDocument,PDFDict,PDFName} from 'pdf-lib';

const help='Use: npm run pdf:qpdf -- --input input.pdf --output restricted.pdf\nSet MALENJO_QPDF_OWNER_PASSWORD (10-128 printable ASCII characters), and optionally MALENJO_QPDF_USER_PASSWORD, in your Codespaces environment. Install the local qpdf CLI first. No network or Windows installer is involved.';
const args={};
if(process.argv.includes('--help')||process.argv.includes('-h')){
  console.log(help);process.exit(0);
}
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--input','--output'].includes(key)||!value||Object.hasOwn(args,key)){
    console.error(help);process.exit(2);
  }
  args[key]=value;
}
if(!args['--input']||!args['--output']){
  console.error(help);process.exit(2);
}
if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<24){
  console.error('This Codespaces provider requires Linux and Node 24 or newer.');
  process.exit(2);
}
const qpdf='qpdf';
function run(argumentsList,input){
  const env={...process.env};
  delete env.MALENJO_QPDF_OWNER_PASSWORD;
  delete env.MALENJO_QPDF_USER_PASSWORD;
  const result=spawnSync(qpdf,argumentsList,{
    input,env,encoding:'utf8',timeout:45000,maxBuffer:128*1024,
    stdio:['pipe','pipe','pipe'],
  });
  if(result.error)throw new Error('Local qpdf executable is unavailable or timed out; install it in Codespaces.');
  return result;
}
function throughStdin(lines){
  for(const line of lines){
    if(/[\r\n\u0000]/.test(line))throw new Error('qpdf argument contains unsupported newline or NUL.');
  }
  const result=run(['@-'],lines.join('\n')+'\n');
  if(result.status!==0)throw new Error('Local qpdf operation failed; source document remains unchanged.');
}
let stage='';
try{
  const input=resolve(args['--input']),output=resolve(args['--output']);
  if(input===output)throw new Error('Output must be distinct from input.');
  if(lstatSync(input).isSymbolicLink())throw new Error('Input must not be a symlink.');
  const directory=realpathSync(dirname(output));
  if(directory!==dirname(output))throw new Error('Output directory may not be a symlink.');
  if(existsSync(output)||existsSync(output+'.execution.json')){
    throw new Error('Refusing to overwrite an existing PDF or receipt.');
  }
  const owner=process.env.MALENJO_QPDF_OWNER_PASSWORD??'';
  const user=process.env.MALENJO_QPDF_USER_PASSWORD??'';
  const printable=value=>/^[\x20-\x7e]*$/.test(value);
  if(!printable(owner)||!printable(user)||owner.length<10||owner.length>128||
     user.length>128||(user.length>0&&user===owner)){
    throw new Error('Owner password must be 10-128 printable ASCII characters, and different from the optional user password.');
  }
  const identity=run(['--version']);
  if(identity.status!==0)throw new Error('The installed qpdf provider could not report its version.');
  const source=Uint8Array.from(readFileSync(input));
  if(source.byteLength<5||source.byteLength>32*1024*1024||
     !Buffer.from(source.slice(0,5)).equals(Buffer.from('%PDF-'))){
    throw new Error('Source must be a nonempty real PDF of at most 32 MB.');
  }
  const document=await PDFDocument.load(source,{ignoreEncryption:false,updateMetadata:false});
  if(document.catalog.has(PDFName.of('Perms'))||
     document.context.enumerateIndirectObjects().some(([,value])=>
       value instanceof PDFDict&&(
         value.has(PDFName.of('ByteRange'))||
         value.get(PDFName.of('FT'))?.toString()==='/Sig'
       ))){
    throw new Error('Signed/certified PDFs must not be silently re-encrypted.');
  }
  stage=mkdtempSync(join(tmpdir(),'malenjo-qpdf-codespaces-'));
  chmodSync(stage,0o700);
  const sourceFile=join(stage,'source.pdf');
  const protectedFile=join(stage,'protected.pdf');
  const decryptedFile=join(stage,'verified-decrypted.pdf');
  writeFileSync(sourceFile,source,{flag:'wx'});
  const sourceEncrypted=run(['--is-encrypted',sourceFile]);
  if(sourceEncrypted.status!==2){
    throw new Error('Already-encrypted or ambiguous PDF input requires a separate owner-authorized workflow.');
  }
  throughStdin([
    '--encrypt',user,owner,'256','--print=none','--modify=none',
    '--extract=n','--','source.pdf','protected.pdf',
  ]);
  if(run(['--is-encrypted',protectedFile]).status!==0){
    throw new Error('qpdf did not generate an encrypted PDF.');
  }
  throughStdin(['--password='+owner,'--decrypt','--','protected.pdf','verified-decrypted.pdf']);
  const decrypted=Uint8Array.from(readFileSync(decryptedFile));
  const reopened=await PDFDocument.load(decrypted,{ignoreEncryption:false,updateMetadata:false});
  if(reopened.getPageCount()!==document.getPageCount()){
    throw new Error('Decrypted output does not reopen with the original PDF page count.');
  }
  const encrypted=Uint8Array.from(readFileSync(protectedFile));
  if(encrypted.length<5||encrypted.length>32*1024*1024){
    throw new Error('AES-256 permissions output exceeded safety limits.');
  }
  writeFileSync(output,encrypted,{flag:'wx'});
  const persisted=Uint8Array.from(readFileSync(output));
  if(!persisted.every((value,index)=>encrypted[index]===value)){
    throw new Error('Saved qpdf output bytes differ from validated encrypted data.');
  }
  if(run(['--is-encrypted',output]).status!==0){
    throw new Error('Saved qpdf output no longer verifies as encrypted.');
  }
  const result={
    schemaVersion:1,provider:'local Linux qpdf',operation:'change-permissions',
    source:basename(input),output:basename(output),
    sha256:createHash('sha256').update(persisted).digest('hex'),
    bytes:persisted.length,
    encryption:'AES-256',flags:'no print, no modify, no extraction',
    verified:'qpdf encrypted check, password-protected decrypt, pdf-lib reopened pages, disk byte identity',
    pageCount:reopened.getPageCount(),
  };
  writeFileSync(output+'.execution.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log('PDF CODESPACES QPDF EXECUTED: '+JSON.stringify(result));
}catch(error){
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}finally{
  if(stage)rmSync(stage,{recursive:true,force:true});
}
