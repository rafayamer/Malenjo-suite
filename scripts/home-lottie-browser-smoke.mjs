/* Independent Chromium acceptance for the local LottieFiles Home accent. */
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
const base='http://127.0.0.1:1421';
let vite, browser;

function assert(condition,message){
  if(!condition)throw new Error('MALENJO Lottie browser acceptance failed: '+message);
}

async function waitForServer(){
  for(let i=0;i<80;i++){
    try{if((await fetch(base,{signal:AbortSignal.timeout(800)})).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('MALENJO Lottie browser server did not start.');
}

try{
  vite=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),
    '--host','127.0.0.1','--port','1421','--strictPort'],{
    cwd:root,stdio:['ignore','pipe','pipe'],
  });
  vite.stdout.on('data',chunk=>process.stdout.write(chunk));
  vite.stderr.on('data',chunk=>process.stderr.write(chunk));
  await waitForServer();

  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({
    viewport:{width:1440,height:900},
    reducedMotion:'no-preference',
  });
  const page=await context.newPage();
  const unexpectedRemote=[];
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    const url=request.url();
    if(/^https?:\/\//.test(url)&&!url.startsWith(base+'/')&&url!==base){
      unexpectedRemote.push(url);
    }
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const icon=page.locator('.ml-start-recent-icon');
  await icon.locator('canvas').waitFor({state:'visible',timeout:20000});
  assert(await icon.locator('canvas').count()===1,
    'locally bundled LottieFiles animation did not render as a canvas');
  assert(unexpectedRemote.length===0,
    'animation/Home initiated unexpected remote HTTP requests: '+unexpectedRemote.join(', '));

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>!document.querySelector('.ml-start-recent-icon canvas'),null,{timeout:10000});
  assert(await icon.locator('svg').count()===1,
    'reduced-motion preference did not restore the static SVG icon');

  const recent=page.getByRole('button',{name:'Recent Files',exact:true});
  await recent.click();
  assert(await recent.getAttribute('aria-expanded')==='true' &&
    await page.locator('#ml-home-recent-panel').isVisible(),
    'the animated icon broke the actual Recent Files action');
  assert(errors.length===0,'unhandled page errors: '+errors.join(' | '));
  console.log('MALENJO local LottieFiles / reduced-motion / Recent Files Chromium: PASS');
  await context.close();
}catch(error){
  console.error(error instanceof Error?error.stack:String(error));
  process.exitCode=1;
}finally{
  await browser?.close();
  vite?.kill('SIGTERM');
}
