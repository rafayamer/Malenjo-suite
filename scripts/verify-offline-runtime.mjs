import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// This gate is run by both the npm packaging command and Tauri's
// beforeBuildCommand, so calling "tauri build" directly cannot bypass it.
const targetsWindows=process.platform==='win32'||
  process.env.CARGO_BUILD_TARGET?.includes('windows')||
  process.argv.includes('--windows');
if(!targetsWindows){
  console.log('Portable Java runtime bundle gate applies to Windows targets only.');
  process.exit(0);
}
const root=resolve(import.meta.dirname,'..');
const dir=resolve(root,'runtime/java');
const java=resolve(dir,'bin/java.exe');
const license=resolve(dir,'legal/java.base/LICENSE');
const release=resolve(dir,'release');
const manifestPath=resolve(dir,'malenjo-runtime-manifest.json');
const coreJar=resolve(root,'provider-packs/stirling-core/stirling-pdf.jar');
for(const file of [java,license,release,manifestPath,coreJar]){
  if(!existsSync(file))throw Error('Windows offline installer cannot be built: missing '+file+'. Run scripts/build-temurin-runtime-windows.ps1 first.');
}
if(readFileSync(coreJar).length<1024)throw Error('Bundled Stirling provider jar is missing or empty.');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));

if(manifest.version!=='25.0.4.1+1'||
   manifest.archiveSha256!=='00c847d804f4a78e9f04f2683faf14fed898535b177b7fc704486cb0284e9283'||
   manifest.component!=='temurin-windows-x64'||
   manifest.runtimeExecutable!=='bin/java.exe'){
  throw Error('Bundled offline Java release is not the reviewed pinned Temurin runtime.');
}
const hash=createHash('sha256').update(readFileSync(java)).digest('hex');
if(hash!==manifest.executableSha256)throw Error('Bundled Java executable SHA256 does not match release manifest.');
const version=readFileSync(release,'utf8');
if(!version.includes('JAVA_VERSION="25.0.4.1"')||!version.includes('IMPLEMENTOR="Eclipse Adoptium"')){
  throw Error('Bundled offline Java vendor or version metadata is unexpected.');
}
console.log('Windows installer offline Java runtime and Stirling core jar are present; Java matches the pinned manifest.');
