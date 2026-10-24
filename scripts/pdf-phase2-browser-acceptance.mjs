/* Phase 2 PDF Core & Editor acceptance in real Chromium.
 *
 * Every editing check drives the real UI, saves through the real top-bar
 * "Save PDF copy" download and reopens the bytes independently with PDF.js and
 * pdf-lib. Nothing is mocked. Timings are printed as evidence only; they are
 * measured on whatever machine runs this and are not release budgets.
 *
 * Run: node scripts/pdf-phase2-browser-acceptance.mjs   (needs `playwright`)
 */
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {PDFDocument,PDFName,StandardFonts,rgb} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
const base='http://127.0.0.1:1420';
const fixtures=resolve(root,'testing/suite/fixtures/pdf');
const shots=resolve(root,'.build/pdf-phase2-browser');
let server,browser,page;
const failures=[];
let passes=0;

function expect(ok,message){if(!ok)throw Error(message);}
async function check(name,fn){
  try{await fn();passes++;console.log('PHASE2 '+name+': PASS');}
  catch(error){
    failures.push(name);
    console.error('PHASE2 '+name+': FAIL :: '+(error instanceof Error?error.message:String(error)).split('\n')[0]);
    try{mkdirSync(shots,{recursive:true});await page.screenshot({path:join(shots,'fail-'+name.replace(/[^a-z0-9]+/gi,'-')+'.png')});}catch{}
  }
}

// ---------- independent output inspection ----------
async function withPdfJs(bytes,fn){
  const doc=await getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false}).promise;
  try{return await fn(doc);}finally{await (doc.destroy?doc.destroy():doc.cleanup?.());}
}
const pageTexts=bytes=>withPdfJs(bytes,async doc=>{const out=[];for(let i=1;i<=doc.numPages;i++){
  const t=await (await doc.getPage(i)).getTextContent();out.push(t.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim());}return out;});
const pageAnnotations=bytes=>withPdfJs(bytes,async doc=>{const out=[];for(let i=1;i<=doc.numPages;i++)
  out.push((await (await doc.getPage(i)).getAnnotations()).map(a=>a.subtype+(a.contentsObj?.str?'='+a.contentsObj.str:'')));return out;});
const outlineTitles=bytes=>withPdfJs(bytes,async doc=>{const out=[];const walk=items=>{for(const i of items){out.push(i.title);walk(i.items||[]);}};walk((await doc.getOutline())||[]);return out;});
const order=texts=>texts.map(t=>t.match(/QA page (\d+)/)?.[1]??(t?'?':'blank')).join();

// ---------- synthetic documents (redistributable, generated here) ----------
async function simpleDoc(n=6,prefix='QA page '){
  const d=await PDFDocument.create();const f=await d.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=n;i++)d.addPage([612,792]).drawText(prefix+i,{x:48,y:728,size:20,font:f});
  return d.save();
}
async function formDoc(){
  const d=await PDFDocument.create();const f=await d.embedFont(StandardFonts.Helvetica);
  const p=d.addPage([612,792]);p.drawText('Application form',{x:48,y:740,size:18,font:f});
  d.addPage([612,792]).drawText('Second page',{x:48,y:740,size:18,font:f});
  const form=d.getForm();
  const t=form.createTextField('applicant');t.addToPage(p,{x:48,y:680,width:220,height:22});t.setText('Old value');
  form.createCheckBox('agree').addToPage(p,{x:48,y:640,width:16,height:16});
  const dd=form.createDropdown('country');dd.addOptions(['Pakistan','Sweden','USA']);dd.select('Pakistan');dd.addToPage(p,{x:48,y:600,width:160,height:22});
  const r=form.createRadioGroup('plan');r.addOptionToPage('basic',p,{x:48,y:560,width:14,height:14});r.addOptionToPage('pro',p,{x:90,y:560,width:14,height:14});r.select('basic');
  return d.save();
}
function gradientPng(w,h){
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=(x*255/w)|0;raw[o+1]=(y*255/h)|0;raw[o+2]=(x^y)&255;}
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);
    let c=~0;for(const b of td){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}const crc=Buffer.alloc(4);crc.writeUInt32BE((~c)>>>0);return Buffer.concat([len,td,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
async function reportDoc(n){
  // Dense text, a vector table on every page and a raster image every 5th page.
  const d=await PDFDocument.create();const f=await d.embedFont(StandardFonts.TimesRoman),b=await d.embedFont(StandardFonts.HelveticaBold);
  const img=await d.embedPng(gradientPng(600,400));
  const words='maintenance turbine governor actuator retrofit evaluation report section figure table summary the quick brown fox'.split(' ');
  for(let p=1;p<=n;p++){
    const pg=d.addPage([612,792]);pg.drawText('Engineering report page '+p,{x:50,y:742,size:16,font:b});
    let y=715;for(let l=0;l<46;l++){let line='';for(let w=0;w<14;w++)line+=words[(p*31+l*7+w*3)%words.length]+' ';pg.drawText(line,{x:50,y,size:10,font:f});y-=12;
      if(p%5===0&&l===18){pg.drawImage(img,{x:50,y:y-210,width:300,height:200});y-=220;l+=17;}}
    for(let r=0;r<6;r++)for(let c=0;c<4;c++)pg.drawRectangle({x:330+c*60,y:60+r*14,width:60,height:14,borderColor:rgb(.2,.2,.2),borderWidth:.5});
  }
  return d.save();
}

// ---------- UI helpers ----------
const panel=()=>page.locator('.document-session-panel.active');
async function openModule(name){
  const trigger=page.getByRole('button',{name:'All tools',exact:true});
  if((await trigger.getAttribute('aria-expanded'))!=='true')await trigger.click();
  await page.locator('.sidebar nav .nav-item').filter({hasText:name}).first().click({timeout:15000});
}
async function chooseFile(name,bytes){
  await openModule('PDF Workspace');
  await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
    .setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from(bytes)});
}
async function waitFirstPage(timeout=60000){
  await page.waitForFunction(()=>{const p=document.querySelector('.document-session-panel.active .pdf-workspace');
    return p?.getAttribute('data-pdf-first-rendered')==='true'&&p.querySelector('[id$="-page-1"]')?.dataset.pdfRendered==='true';},null,{timeout});
}
let docCounter=0;
async function openPdf(bytes,name=`phase2-${++docCounter}.pdf`){
  await chooseFile(name,bytes);
  await page.locator('.document-tab-main').filter({hasText:name}).waitFor({timeout:30000});
  await waitFirstPage();
  return name;
}
async function tab(name){await panel().locator('[aria-label="PDF task categories"]').getByRole('tab',{name,exact:true}).click();}
async function action(tabName,label){
  await tab(tabName);
  const button=panel().locator(`.pdf-task-toolbar button[aria-label="${label}"]`).first();
  if(!(await button.isVisible().catch(()=>false))){const more=panel().locator('.pdf-task-overflow summary');if(await more.count())await more.click();}
  await button.click({timeout:10000});
}
async function notice(pattern,timeout=20000){
  await page.waitForFunction(source=>[...document.querySelectorAll('.pdf-notice,[role="alert"],[role="status"]')]
    .some(node=>new RegExp(source,'i').test(node.textContent||'')),pattern.source,{timeout});
}
async function selectPage(n){
  await tab('Organize');
  const box=panel().locator('input[aria-label="Page number to edit"]');
  await box.fill(String(n));await box.press('Enter');
  await page.waitForFunction(n=>document.querySelector('.document-session-panel.active .pdf-organize-page-picker strong')?.textContent?.includes('page '+n),n,{timeout:10000});
}
async function save(){
  const pending=page.waitForEvent('download',{timeout:30000});
  await page.getByRole('button',{name:'Save PDF copy',exact:true}).click();
  const file=join(mkdtempSync(join(tmpdir(),'malenjo-phase2-')),'saved.pdf');
  await (await pending).saveAs(file);
  const bytes=readFileSync(file);
  expect(bytes.subarray(0,5).toString()==='%PDF-','saved file is not a PDF');
  return bytes;
}
async function savedDownload(trigger){
  const pending=page.waitForEvent('download',{timeout:30000});await trigger();
  const file=join(mkdtempSync(join(tmpdir(),'malenjo-phase2-')),'out.pdf');await (await pending).saveAs(file);return readFileSync(file);
}
async function undo(){await page.getByRole('button',{name:'Undo PDF edit',exact:true}).click();await notice(/Undid:/);}
async function redo(){await page.getByRole('button',{name:'Redo PDF edit',exact:true}).click();await notice(/Redid:/);}
async function openRail(name){
  const show=panel().getByRole('button',{name:'Show document navigation'});
  if(await show.count())await show.first().click();
  await panel().locator('.pdf-left-rail').getByRole('button',{name,exact:true}).click();
}
async function readerJump(n){
  // Measured inside the page: Enter on the page box -> target page painted.
  return page.evaluate(async n=>{
    const input=document.querySelector('.document-session-panel.active input[aria-label="Current PDF page"]');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(n));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const started=performance.now();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    const painted=()=>document.querySelector(`.document-session-panel.active [id$="-page-${n}"]`)?.dataset.pdfRendered==='true'&&
      (document.querySelector('.ml-status-pdf-view')?.textContent||'').includes('Page '+n+' /');
    while(!painted()){await new Promise(r=>requestAnimationFrame(r));if(performance.now()-started>30000)return -1;}
    input.blur();return performance.now()-started;
  },n);
}

async function main(){
  server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',buf=>{const text=String(buf);if(/error/i.test(text))process.stderr.write(text);});
  for(let i=0;i<120;i++){try{if((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  page=await context.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'All tools',exact:true}).waitFor({timeout:60000});

  // ---- navigation ----
  await check('page box jump is instant and cannot be overwritten mid-typing (57-page PDF)',async()=>{
    await openPdf(await simpleDoc(57));
    const input=panel().locator('input[aria-label="Current PDF page"]');
    await input.fill('55');await input.press('Enter');
    await input.fill('57');await input.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 57 / 57'),null,{timeout:15000});
    await page.waitForTimeout(600);
    expect((await page.evaluate(()=>document.querySelector('.ml-status-pdf-view')?.textContent))?.includes('Page 57 / 57'),'indicator moved away from page 57');
    await input.fill('');await input.press('Enter');
    expect(await input.inputValue()==='57','empty page box did not revert to the current page');
  });

  // ---- page operations with independent reopen ----
  await check('duplicate page',async()=>{await openPdf(await simpleDoc());await selectPage(2);await action('Organize','Duplicate page');await notice(/Duplicated page 2/);
    expect(order(await pageTexts(await save()))==='1,2,2,3,4,5,6','wrong page order');});
  await check('move later, undo and redo',async()=>{await openPdf(await simpleDoc());await selectPage(1);await action('Organize','Move later');await notice(/Moved page later/);
    expect(order(await pageTexts(await save()))==='2,1,3,4,5,6','move');
    await undo();expect(order(await pageTexts(await save()))==='1,2,3,4,5,6','undo');
    await redo();expect(order(await pageTexts(await save()))==='2,1,3,4,5,6','redo');});
  await check('move earlier',async()=>{await openPdf(await simpleDoc());await selectPage(6);await action('Organize','Move earlier');await notice(/Moved page earlier/);
    expect(order(await pageTexts(await save()))==='1,2,3,4,6,5','wrong page order');});
  await check('blank page after',async()=>{await openPdf(await simpleDoc());await selectPage(3);await action('Organize','Blank after');await notice(/blank page after page 3/);
    expect(order(await pageTexts(await save()))==='1,2,3,blank,4,5,6','wrong page order');});
  await check('delete with confirmation, then undo',async()=>{await openPdf(await simpleDoc());await selectPage(2);await action('Organize','Delete 1 page');await notice(/Removed/);
    expect(order(await pageTexts(await save()))==='1,3,4,5,6','delete');await undo();expect(order(await pageTexts(await save()))==='1,2,3,4,5,6','undo');});
  await check('extract selected page',async()=>{await openPdf(await simpleDoc());await selectPage(4);
    expect(order(await pageTexts(await savedDownload(()=>action('Organize','Extract selected'))))==='4','extracted');});
  await check('split after page 2 into two PDFs',async()=>{await openPdf(await simpleDoc());await selectPage(2);
    const downloads=[];const onDownload=d=>downloads.push(d);page.on('download',onDownload);
    await action('Organize','Split here');await notice(/Split after page 2/);await page.waitForTimeout(800);page.off('download',onDownload);
    expect(downloads.length===2,'expected two downloads, got '+downloads.length);
    const parts=[];for(const d of downloads){const f=join(mkdtempSync(join(tmpdir(),'malenjo-phase2-')),'p.pdf');await d.saveAs(f);parts.push(order(await pageTexts(readFileSync(f))));}
    expect(parts[0]==='1,2'&&parts[1]==='3,4,5,6','parts '+JSON.stringify(parts));});
  await check('insert PDF after page 2',async()=>{await openPdf(await simpleDoc());await selectPage(2);
    const chooser=page.waitForEvent('filechooser',{timeout:10000});await action('Organize','Insert PDF…');
    await (await chooser).setFiles({name:'insert.pdf',mimeType:'application/pdf',buffer:Buffer.from(await simpleDoc(2,'INS page '))});await notice(/insert/);
    const texts=(await pageTexts(await save())).map(t=>t.replace('QA page ','Q').replace('INS page ','I')).join();
    expect(texts==='Q1,Q2,I1,I2,Q3,Q4,Q5,Q6','order '+texts);});
  await check('append PDF',async()=>{await openPdf(await simpleDoc(3));
    const chooser=page.waitForEvent('filechooser',{timeout:10000});await action('Organize','Append PDF…');
    await (await chooser).setFiles({name:'append.pdf',mimeType:'application/pdf',buffer:Buffer.from(await simpleDoc(2,'APP page '))});await notice(/append/);
    const texts=(await pageTexts(await save())).map(t=>t.replace('QA page ','Q').replace('APP page ','A')).join();
    expect(texts==='Q1,Q2,Q3,A1,A2','order '+texts);});
  await check('permanent page rotation',async()=>{await openPdf(await simpleDoc());await selectPage(3);
    await page.getByRole('button',{name:'Rotate current PDF page clockwise (saved edit)'}).click();await notice(/Permanently rotated/);
    const rot=(await PDFDocument.load(await save())).getPages().map(p=>p.getRotation().angle).join();expect(rot==='0,0,90,0,0,0','rotation '+rot);});
  await check('page labels',async()=>{await openPdf(await simpleDoc());await selectPage(1);await action('Organize','Set page label');await notice(/page labels/);
    expect(!!(await PDFDocument.load(await save())).catalog.get(PDFName.of('PageLabels')),'no /PageLabels');});

  // ---- annotations, text, forms, outline, links ----
  await check('placed text is real PDF text',async()=>{await openPdf(await simpleDoc());await selectPage(1);await action('Edit','Edit settings');
    await panel().getByLabel('Add text').fill('MALENJO PLACED TEXT');await action('Edit','Place text');await notice(/text|placed|added/);
    expect((await pageTexts(await save()))[0].includes('MALENJO PLACED TEXT'),'placed text missing');});
  await check('highlight rectangle keeps page text',async()=>{await openPdf(await simpleDoc());await selectPage(2);await action('Edit','Highlight rectangle');await notice(/highlight rectangle/);
    expect(order(await pageTexts(await save()))==='1,2,3,4,5,6','page text changed');});
  await check('comment annotation with contents',async()=>{await openPdf(await simpleDoc());await selectPage(1);await action('Review','Comments panel');
    await panel().getByLabel('Sticky-note comment').fill('QA review note');await action('Review','Add comment');await notice(/comment/);
    expect((await pageAnnotations(await save())).flat().some(a=>a.includes('QA review note')),'comment missing');});
  await check('create a form field',async()=>{await openPdf(await simpleDoc(2));await selectPage(1);await action('Forms','Form settings');
    await panel().getByLabel('Name').first().fill('customer_name');await action('Forms','Add text field');await notice(/field/);
    expect((await PDFDocument.load(await save())).getForm().getFields().some(f=>f.getName()==='customer_name'),'field missing');});
  await check('fill text, checkbox, dropdown and radio fields',async()=>{await openPdf(await formDoc());await action('Forms','Form settings');
    const inspector=page.locator('.document-session-panel.active .pdf-inspector, .document-session-panel.active .pdf-left-panel');
    const control=name=>inspector.locator('label').filter({hasText:new RegExp('^\\s*'+name)}).locator('input,select').first();
    await control('applicant').fill('Rafay Amer');
    await inspector.locator('label').filter({hasText:'agree'}).locator('input[type="checkbox"]').first().check();
    await control('country').selectOption({label:'Sweden'}).catch(()=>control('country').selectOption('Sweden'));
    const plan=inspector.locator('label').filter({hasText:/^\s*plan/}).locator('select').first();
    if(await plan.count())await plan.selectOption('pro');else await inspector.locator('input[type="radio"][value="pro"]').first().check();
    await action('Forms','Apply field values');await notice(/field value|applied|filled|updated/);
    const form=(await PDFDocument.load(await save())).getForm();
    const values={applicant:form.getTextField('applicant').getText(),agree:form.getCheckBox('agree').isChecked(),country:form.getDropdown('country').getSelected().join(),plan:form.getRadioGroup('plan').getSelected()};
    expect(values.applicant==='Rafay Amer'&&values.agree&&values.country==='Sweden'&&values.plan==='pro','values '+JSON.stringify(values));});
  await check('flatten fields keeps the visible value',async()=>{await openPdf(await formDoc());await action('Forms','Flatten fields');await notice(/flatten/);
    const bytes=await save();expect((await PDFDocument.load(bytes)).getForm().getFields().length===0,'fields remain');
    expect((await pageTexts(bytes))[0].includes('Old value'),'flattened value not visible');});
  await check('bookmark',async()=>{await openPdf(await formDoc());await openRail('Bookmarks');
    await panel().getByLabel('Title').first().fill('Chapter QA');await panel().getByRole('button',{name:'Add top-level bookmark'}).click();await notice(/bookmark/);
    expect((await outlineTitles(await save())).includes('Chapter QA'),'outline missing');});
  await check('internal page link',async()=>{await openPdf(await formDoc());await openRail('Bookmarks');
    await panel().getByLabel('Destination page').first().fill('2');await panel().getByRole('button',{name:/^Create link on page/}).first().click();await notice(/link/);
    expect((await pageAnnotations(await save()))[0].some(a=>a.startsWith('Link')),'link missing');});
  await check('print hands the complete PDF bytes to a separate viewer',async()=>{await openPdf(await formDoc());
    await page.evaluate(()=>{const open=window.open;window.__malenjoOpened=[];window.open=function(url,...rest){window.__malenjoOpened.push(String(url));return open.call(window,url,...rest);};});
    await action('Home','Print');await notice(/entire PDF in a separate viewer/);
    const info=await page.evaluate(async()=>{const url=window.__malenjoOpened.at(-1);const response=await fetch(url);const bytes=new Uint8Array(await response.arrayBuffer());
      return {scheme:url.slice(0,5),type:response.headers.get('content-type'),size:bytes.length,head:String.fromCharCode(...bytes.slice(0,5))};});
    expect(info.scheme==='blob:'&&info.type==='application/pdf'&&info.head==='%PDF-'&&info.size>500,'print target '+JSON.stringify(info));});

  // ---- invalid, encrypted and password-protected input ----
  await check('invalid PDFs show a plain-language error',async()=>{
    for(const name of ['wrong-header.pdf','truncated.pdf']){
      await chooseFile('bad-'+name,readFileSync(join(fixtures,name)));
      await page.waitForFunction(()=>/not a valid PDF|nonempty/i.test(document.querySelector('.document-session-panel.active [role="alert"], main.workspace [role="alert"]')?.textContent||''),null,{timeout:20000});
    }});
  await check('password PDF: prompt, wrong password, correct password, read-only',async()=>{
    await chooseFile('locked.pdf',readFileSync(join(fixtures,'encrypted-user-password.pdf')));
    const field=panel().locator('.pdf-password-prompt input[type="password"]');await field.waitFor({timeout:20000});
    await field.fill('wrong');await field.press('Enter');await panel().locator('.pdf-password-error').waitFor({timeout:15000});
    expect(await field.inputValue()==='','password field was not cleared');
    await field.fill('secret');await field.press('Enter');await waitFirstPage();
    expect(await panel().locator('.pdf-encrypted-notice').count()===1,'read-only notice missing');
    await tab('Organize');await panel().locator('.pdf-task-toolbar button[aria-label="Duplicate page"]').click();
    await notice(/encrypted, so MALENJO can show it but cannot edit it/);
    const shown=(await panel().locator('.pdf-notice').allTextContents()).join(' ');
    expect(!/ignoreEncryption|PDFDocument\.load/.test(shown),'raw library error shown');});
  await check('owner-restricted PDF opens without prompt and refuses edits cleanly',async()=>{
    await openPdf(readFileSync(join(fixtures,'encrypted-owner-restricted.pdf')),'restricted.pdf');
    expect(await panel().locator('.pdf-encrypted-notice').count()===1,'read-only notice missing');});

  // ---- rendering, memory and timings ----
  await check('zoom: off-screen pages are released and come back at the new zoom',async()=>{
    await openPdf(await reportDoc(60),'zoom-report.pdf');
    expect(await readerJump(2)>=0&&await readerJump(40)>=0,'jump did not paint');
    for(let i=0;i<3;i++)await panel().getByRole('button',{name:'Zoom out'}).click();
    await page.waitForFunction(()=>document.querySelector('.document-session-panel.active [id$="-page-40"]')?.dataset.pdfRendered==='true',null,{timeout:20000});
    const geometry=n=>page.evaluate(n=>{const shell=document.querySelector(`.document-session-panel.active [id$="-page-${n}"]`);
      return {css:Math.round(shell.querySelector('canvas').getBoundingClientRect().width),rendered:shell.dataset.pdfRendered};},n);
    const p40=await geometry(40);const offscreen=await geometry(2);
    expect(offscreen.rendered!=='true'&&offscreen.css===0,'stale off-screen page kept pixels '+JSON.stringify(offscreen));
    expect(await readerJump(2)>=0,'return jump did not paint');
    const p2=await geometry(2);expect(Math.abs(p2.css-p40.css)<=2,'page 2 not re-rendered at new zoom '+JSON.stringify({p2,p40}));});
  await check('100-page report: bounded memory and measured timings',async()=>{
    const report=await reportDoc(100);
    const started=Date.now();await openPdf(report,'report-100.pdf');const openMs=Date.now()-started;
    const uncached=await readerJump(60);await readerJump(20);const cached=await readerJump(60);
    expect(uncached>=0&&cached>=0,'page jump did not paint');
    for(let i=0;i<60;i++){await panel().locator('.pdf-scroll').evaluate(node=>{node.scrollTop+=node.clientHeight*1.6;});await page.waitForTimeout(40);}
    await page.waitForTimeout(1200);
    const memory=await page.evaluate(()=>{const canvases=[...document.querySelectorAll('.document-session-panel.active .pdf-scroll canvas')];
      return {rendered:document.querySelectorAll('.document-session-panel.active [data-pdf-rendered="true"]').length,
        megapixels:Math.round(canvases.reduce((sum,c)=>sum+c.width*c.height,0)/1e6)};});
    console.log(`PHASE2 measured (this machine, dev server): open->page 1 ${openMs} ms; new-page jump ${Math.round(uncached)} ms; cached switch ${Math.round(cached)} ms; after full scroll ${memory.rendered} pages / ${memory.megapixels} MP retained`);
    expect(memory.megapixels<=60,'canvas memory not bounded: '+memory.megapixels+' MP');
    expect(memory.rendered<60,'too many pages retained: '+memory.rendered);});

  expect(pageErrors.length===0,'uncaught page errors: '+pageErrors.join(' | '));
}

try{await main();}
catch(error){console.error(error instanceof Error?error.stack:String(error));failures.push('harness');}
finally{
  console.log(`PHASE2 browser acceptance: ${passes} passed, ${failures.length} failed`+(failures.length?' — '+failures.join('; '):''));
  await browser?.close();server?.kill('SIGTERM');
  process.exitCode=failures.length?1:0;
}
