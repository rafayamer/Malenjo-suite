/* Real Chromium user-interface smoke: no mocked PDF rendering or downloads. */
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import {zipSync,strToU8,strFromU8,unzipSync} from 'fflate';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'..');
const base='http://127.0.0.1:1420';
let server,browser,acceptancePage;
function requireEvidence(ok,message){if(!ok)throw Error('PDF browser acceptance failure: '+message);}
async function waitForServer(){
  for(let i=0;i<90;i++){
    try{if((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('MALENJO development browser did not start.');
}
async function main(){
  const sourceDoc=await PDFDocument.create();
  const font=await sourceDoc.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=2;i++){
    const page=sourceDoc.addPage([500,700]);
    page.drawText('MALENJO BROWSER UI TEXT SELECT FIND '+i,{x:40,y:550,font,size:18});
  }
  const source=Buffer.from(await sourceDoc.save({useObjectStreams:false}));
  // Spawn Vite directly so killing the child also closes its stdout/stderr.
  // npm run dev:codespace spawns a shell which leaves Vite alive in CI.
  server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','0.0.0.0'],{
    cwd:root,stdio:['ignore','pipe','pipe'],
  });
  server.stdout.on('data',buf=>process.stdout.write(buf));
  server.stderr.on('data',buf=>process.stderr.write(buf));
  await waitForServer();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const page=await context.newPage();
  acceptancePage=page;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  // Phase 3: exercise every real navigation surface, not only the PDF tab.
  // This proves shell launchability, not the underlying domain workflows.
  const modulesText=readFileSync(resolve(root,'src/suite/modules/registry.ts'),'utf8');
  const moduleNames=Array.from(modulesText.matchAll(/\{\s*id:'[^']+',\s*name:'([^']+)'/g),match=>match[1]);
  requireEvidence(moduleNames.length===22&&new Set(moduleNames).size===22,
    'not all 22 source-defined workspaces are available for browser verification');
  for(const name of moduleNames){
    const entry=page.locator('.sidebar nav .nav-item').filter({hasText:name}).first();
    await entry.click({timeout:15000});
    await page.waitForFunction(expected=>
      document.querySelector('.sidebar nav .nav-item.active')?.getAttribute('aria-label')===expected,
      name,{timeout:15000});
    const content=(await page.locator('main.workspace').innerText()).trim();
    requireEvidence(content.length>15,
      'Workspace '+name+' has no usable page or clear capability status');
    requireEvidence(errors.length===0,
      'Unhandled error after navigating to '+name+': '+errors.join(' | '));
    console.log('PHASE3 module launch/navigation: '+name+' PASS (shell only)');
  }
  console.log('PHASE3 22/22 module shell-navigation smoke: PASS (not module functionality sign-off)');
  await page.locator('.sidebar nav .nav-item').filter({hasText:'Home'}).first().click();

  // Real end-to-end browser workflows for the three Office workspaces.
  // Edit the actual OOXML package via its UI, retain state across navigation,
  // export a new copy and independently inspect reopened ZIP contents.
  const officeCases=[
    {
      module:'Document Workspace',filename:'phase3-word.docx',
      mimetype:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      parts:{
        '[Content_Types].xml':'<Types/>',
        'word/document.xml':'<w:document><w:body><w:p><w:r><w:t>Initial document</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
        'custom/preserve.xml':'<retained>word asset</retained>',
      },
      editor:'textarea[aria-label="DOCX text editor"]',updated:'Real browser DOCX edit',
      xmlPart:'word/document.xml',preservedPart:'custom/preserve.xml',
    },
    {
      module:'Spreadsheet',filename:'phase3-sheet.xlsx',
      mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      parts:{
        'xl/workbook.xml':'<workbook><sheets><sheet name="Data"/></sheets></workbook>',
        'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Initial cell</t></is></c><c r="B1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>',
        'custom/preserve.xml':'<retained>sheet asset</retained>',
      },
      editor:'input[aria-label="Cell A1"]',updated:'Real browser XLSX edit',
      xmlPart:'xl/worksheets/sheet1.xml',preservedPart:'custom/preserve.xml',
      preservedXml:'<f>2+2</f>',
    },
    {
      module:'Presentation',filename:'phase3-slides.pptx',
      mimetype:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      parts:{
        'ppt/presentation.xml':'<p:presentation/>',
        'ppt/slides/slide1.xml':'<p:sld><a:t>Initial slide</a:t><a:t>Original notes</a:t></p:sld>',
        'custom/preserve.xml':'<retained>slide asset</retained>',
      },
      editor:'input.slide-title-input',updated:'Real browser PPTX edit',
      xmlPart:'ppt/slides/slide1.xml',preservedPart:'custom/preserve.xml',
      preservedXml:'Original notes',
    },
  ];
  for(const item of officeCases){
    const original=Buffer.from(zipSync(Object.fromEntries(
      Object.entries(item.parts).map(([name,text])=>[name,strToU8(text)]))));
    await page.locator('.sidebar nav .nav-item')
      .filter({hasText:item.module}).first().click();
    await page.locator('main.workspace > .office-workspace input[type="file"]').first()
      .setInputFiles({name:item.filename,mimeType:item.mimetype,buffer:original});
    const officeTab=page.locator('.document-tab-main').filter({hasText:item.filename});
    await officeTab.waitFor({timeout:30000});
    const editor=page.locator('.document-session-panel.active').locator(item.editor);
    await editor.waitFor({timeout:30000});
    await editor.fill(item.updated);
    // The editor must not silently discard unsaved edits after leaving.
    await page.locator('.sidebar nav .nav-item').filter({hasText:'Home'}).first().click();
    await officeTab.click();
    requireEvidence(await editor.inputValue()===item.updated,
      'Office session lost edits when switching modules: '+item.module);
    const waitDownload=page.waitForEvent('download',{timeout:30000});
    await page.locator('.document-session-panel.active .office-toolbar')
      .getByRole('button',{name:'Export copy'}).click();
    const exported=await waitDownload;
    const dest=join(mkdtempSync(join(tmpdir(),'malenjo-office-acceptance-')),'edited-'+item.filename);
    await exported.saveAs(dest);
    const restored=unzipSync(readFileSync(dest));
    requireEvidence(Boolean(restored[item.xmlPart]),
      'Exported Office document has no required OOXML content part: '+item.module);
    requireEvidence(strFromU8(restored[item.xmlPart]).includes(item.updated),
      'Exported Office document lost the edited content: '+item.module);
    requireEvidence(strFromU8(restored[item.preservedPart])===item.parts[item.preservedPart],
      'Exported Office document lost an unrelated original package part: '+item.module);
    if(item.preservedXml)requireEvidence(strFromU8(restored[item.xmlPart]).includes(item.preservedXml),
      'Exported Office document damaged an untouched formula/run: '+item.module);
    requireEvidence(Buffer.from(zipSync(Object.fromEntries(
      Object.entries(item.parts).map(([name,text])=>[name,strToU8(text)])))).equals(original),
      'Office editor changed the original imported source: '+item.module);
    requireEvidence(errors.length===0,'Office browser exception: '+errors.join(' | '));
    console.log('PHASE3 Office edit/navigation/export/reopen: '+item.module+' PASS (synthetic fixture only)');
  }
  await page.locator('.sidebar nav .nav-item').filter({hasText:'Home'}).first().click();
  console.log('MALENJO loaded in Chromium; opening PDF via browser input');
  await page.locator('.workspace > input[type="file"]').setInputFiles({
    name:'browser-ui-acceptance.pdf',mimeType:'application/pdf',buffer:source,
  });
  const documentTab=page.locator('.document-tab-main').filter({hasText:'browser-ui-acceptance.pdf'});
  await documentTab.waitFor({timeout:30000});
  console.log('MALENJO browser document tab opened');
  await page.waitForFunction(()=>
    Array.from(document.querySelectorAll('.pdf-text-layer span')).some(
      node=>node.textContent?.includes('MALENJO BROWSER UI TEXT SELECT FIND'),
    ),null,{timeout:30000});
  const span=page.locator('.pdf-text-layer span').filter({hasText:'MALENJO BROWSER UI TEXT SELECT FIND'}).first();
  console.log('MALENJO real PDF.js selectable text spans rendered');
  const selected=await span.evaluate(node=>{
    const range=document.createRange(),selection=window.getSelection();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const text=selection?.toString()??'';
    selection?.removeAllRanges();
    return {cursor:getComputedStyle(node).cursor,selection:text};
  });
  requireEvidence(selected.cursor==='text','PDF hover does not show I-beam');
  requireEvidence(selected.selection.includes('MALENJO BROWSER UI'),
    'PDF text cannot be selected and copied');
  console.log('MALENJO UI text selection: PASS');
  await page.getByRole('button',{name:'Find words in PDF'}).click();
  await page.getByRole('textbox',{name:'Find PDF text'}).fill('BROWSER UI');
  await page.getByRole('button',{name:'Find in PDF'}).click();
  await page.waitForFunction(()=>
    document.querySelector('.pdf-search-status')?.textContent?.includes('match')&&
    document.querySelectorAll('.pdf-text-match').length>0,
  null,{timeout:30000});
  requireEvidence(/2 match/i.test(await page.locator('.pdf-search-status').innerText()),
    'Find did not report matches from two real PDF pages');
  console.log('MALENJO UI Find + visible text highlights: PASS');
  await page.locator('.sidebar .nav-item').filter({hasText:'Home'}).first().click();
  await documentTab.click();
  await page.locator('.pdf-page-shell canvas').first().waitFor({timeout:30000});
  requireEvidence(await documentTab.count()===1,'browser PDF tab vanished after navigation');
  console.log('MALENJO browser tab retention: PASS');
  // Also exercise the exact direct PDF Workspace -> Choose PDF path, which
  // previously opened a disposable preview that vanished on navigation.
  await page.locator('.sidebar .nav-item').filter({hasText:'PDF Workspace'}).first().click();
  await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
    .setInputFiles({
      name:'standalone-picker-keeps-tab.pdf',
      mimeType:'application/pdf',
      buffer:source,
    });
  const pickerTab=page.locator('.document-tab-main').filter({hasText:'standalone-picker-keeps-tab.pdf'});
  await pickerTab.waitFor({timeout:20000});
  await page.locator('.sidebar .nav-item').filter({hasText:'Home'}).first().click();
  await pickerTab.click();
  requireEvidence(await pickerTab.count()===1,
    'the PDF Workspace picker did not keep the opened document in a regular tab');
  console.log('MALENJO PDF Workspace Choose PDF tab retention: PASS');
  // Return to the original PDF to verify edit/export without altering it.
  await documentTab.click();
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:'Organize'}).click();
  await page.locator('.document-session-panel.active .pdf-context-toolbar button').filter({hasText:/^Rotate selected$/}).click();
  await page.waitForFunction(()=>
    Array.from(document.querySelectorAll('.pdf-notice')).some(
      node=>node.textContent?.includes('Permanently rotated'),
    ),null,{timeout:30000});
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:/^Home$/}).click();
  const pendingDownload=page.waitForEvent('download',{timeout:30000});
  await page.locator('.document-session-panel.active .pdf-context-toolbar button').filter({hasText:/^Export$/}).click();
  const download=await pendingDownload;
  const destination=join(mkdtempSync(join(tmpdir(),'malenjo-browser-pdf-')),'exported.pdf');
  await download.saveAs(destination);
  const bytes=readFileSync(destination);
  requireEvidence(bytes.subarray(0,5).toString()==='%PDF-','downloaded file is not a PDF');
  const reopened=await PDFDocument.load(bytes);
  requireEvidence(reopened.getPageCount()===2&&reopened.getPage(0).getRotation().angle===90,
    'UI rotation was missing from reopened browser export');
  requireEvidence((await PDFDocument.load(source)).getPage(0).getRotation().angle===0,
    'original source was unexpectedly modified');
  console.log('MALENJO UI rotate, download, reopen and original preservation: PASS');
  // MAL-AUD-020: Click a real PDF /Link annotation over the rendered canvas.
  const linked=await PDFDocument.create();
  const firstLinkPage=linked.addPage([500,700]);
  const destinationPage=linked.addPage([500,700]);
  const annotation=linked.context.register(linked.context.obj({
    Subtype:PDFName.of('Link'),Rect:[50,530,230,575],
    Dest:linked.context.obj([destinationPage.ref,PDFName.of('Fit')]),
  }));
  firstLinkPage.node.set(PDFName.of('Annots'),linked.context.obj([annotation]));
  const linkedBytes=Buffer.from(await linked.save({useObjectStreams:false}));
  await page.locator('.sidebar .nav-item').filter({hasText:'PDF Workspace'}).first().click();
  await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
    .setInputFiles({name:'safe-link-acceptance.pdf',mimeType:'application/pdf',buffer:linkedBytes});
  const linkTab=page.locator('.document-tab-main').filter({hasText:'safe-link-acceptance.pdf'});
  await linkTab.waitFor({timeout:30000});
  const hit=page.locator('.document-session-panel.active .pdf-link-hitbox').first();
  await hit.waitFor({timeout:30000});
  await hit.click();
  await page.waitForFunction(()=>
    document.querySelector('.document-session-panel.active input[aria-label="Current PDF page"]')?.value==='2',
    null,{timeout:15000});
  console.log('MALENJO on-page PDF internal hyperlink activation: PASS');

  requireEvidence(errors.length===0,'Unhandled browser exceptions: '+errors.join(' | '));
  await context.close();
  console.log('MALENJO browser PDF acceptance PASSED');
}
try{await main();}
catch(error){
  if(acceptancePage){
    try{
      const path=resolve(root,'.build/pdf-ui-browser/failure.png');
      mkdirSync(resolve(root,'.build/pdf-ui-browser'),{recursive:true});
      await acceptancePage.screenshot({path,fullPage:true,timeout:10000});
      console.error('MALENJO browser screenshot on failure: '+path);
    }catch(reason){
      console.error('Could not capture failing browser screenshot:',String(reason));
    }
  }
  console.error(error instanceof Error?error.stack:String(error));
  process.exitCode=1;
}finally{
  await browser?.close();
  server?.kill('SIGTERM');
}
