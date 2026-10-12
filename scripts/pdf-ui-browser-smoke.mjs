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
  async function openModule(name){
    const trigger=page.getByRole('button',{name:'All tools',exact:true});
    if((await trigger.getAttribute('aria-expanded'))!=='true')await trigger.click();
    const entry=page.locator('.sidebar nav .nav-item').filter({hasText:name}).first();
    await entry.click({timeout:15000});
    requireEvidence((await trigger.getAttribute('aria-expanded'))==='false',
      'Top toolbar tools menu did not dismiss after choosing '+name);
  }
  requireEvidence(await page.locator('.sidebar:not(.ml-tools-popup)').count()===0 &&
    await page.locator('.app-shell-top-only').count()===1,
    'Permanent module sidebar was not eliminated');
  requireEvidence(await page.getByRole('button',{name:'Open File',exact:true}).isVisible() &&
    await page.getByRole('button',{name:'Recent Files',exact:true}).isVisible(),
    'Minimal central Home Open File / Recent Files entry points are missing');
  requireEvidence(await page.locator('.ml-start-more-tools:not([open])').count()===1,
    'Extra Home dashboard tools must remain hidden until requested');
  requireEvidence(await page.getByRole('button',{name:'MALENJO AI',exact:true}).count()===1,
    'AI control missing from the top command bar');

  // UI/UX Phase 3: Home and PDF share one Windows-style ribbon shell.
  // Verify a real palette switch, persistence after reload and same-window
  // navigation rather than only checking the presence of a decorative toggle.
  await page.getByRole('tab',{name:'Home',exact:true}).waitFor({timeout:15000});
  // Home is not an independent Word/Excel/PowerPoint opener. Those outputs
  // must originate from a successful PDF conversion (still a release blocker).
  await page.locator('.ml-start-more-tools summary').click();
  for(const label of ['PDF to Word','PDF to Excel','PDF to Slides']){
    const action=page.locator('.ml-co-actions .ml-co-action-card').filter({hasText:label});
    await action.waitFor({timeout:15000});
    requireEvidence(await action.isDisabled() && (await action.getAttribute('aria-description'))?.includes('conversion'),
      'Home incorrectly advertises an unverified independent Office launch: '+label);
  }
  // Office documents are not independent MALENJO imports.
  requireEvidence((await page.locator('.workspace > input[type="file"]').getAttribute('accept'))===
      '.pdf,.dxf,.dwg,.dcm,.dicom',
    'Public opener still accepts standalone Office files');
  await page.locator('.workspace > input[type="file"]').setInputFiles({
    name:'forbidden-standalone.docx',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer:Buffer.from('This file must not open as an independent editor'),
  });
  requireEvidence(await page.locator('.document-tab-main').filter({hasText:'forbidden-standalone.docx'}).count()===0,
    'Independent Word document opened without successful PDF conversion');
  requireEvidence(await page.locator('.ml-open-feedback').isVisible() &&
    /only PDF, CAD and DICOM/i.test(await page.locator('.ml-open-feedback').innerText()),
    'Rejected Office import did not explain the PDF-first opening policy');
  await page.getByRole('button',{name:'Dismiss file notice'}).click();
  await page.getByRole('button',{name:'All tools',exact:true}).click();
  for(const forbidden of ['Document Workspace','Spreadsheet','Presentation','Malenjo AI']){
    requireEvidence(await page.locator('.ml-tools-popup nav .nav-item[aria-label="'+forbidden+'"]').count()===0,
      'Standalone '+forbidden+' appeared in the user-facing top Tools menu');
  }
  await page.getByRole('button',{name:'Close tools menu'}).click();
  console.log('PHASE1 PDF/CAD/DICOM-only direct open, Office conversion-only gating: PASS');
  // AI belongs in the top bar and behaves as a persistent Messenger-like
  // chat drawer, not a standalone module or a second browser window.
  const aiButton=page.getByRole('button',{name:'MALENJO AI',exact:true});
  await aiButton.click();
  const aiDrawer=page.locator('#ml-ai-assistant');
  await aiDrawer.waitFor({state:'visible',timeout:15000});
  requireEvidence(await aiButton.getAttribute('aria-expanded')==='true' &&
    await aiDrawer.locator('.ai-bubble').count()===0 &&
    await aiDrawer.locator('.ai-composer textarea').isVisible(),
    'AI top icon did not open the actual local chat interface');
  await aiDrawer.locator('.ai-composer textarea').fill('Help me review a PDF');
  await aiDrawer.getByRole('button',{name:'Send'}).click();
  await aiDrawer.locator('.ai-bubble.user').filter({hasText:'Help me review a PDF'}).waitFor({timeout:15000});
  await aiDrawer.getByRole('button',{name:'Close MALENJO AI'}).click();
  requireEvidence(await aiDrawer.isHidden() && await aiButton.getAttribute('aria-expanded')==='false',
    'AI did not close from the top bar without losing the main workspace');
  await aiButton.click();
  requireEvidence(await aiDrawer.locator('.ai-bubble.user').filter({hasText:'Help me review a PDF'}).count()===1,
    'AI chat history vanished when the side panel was toggled');
  await aiButton.click();
  requireEvidence(context.pages().length===1,'MALENJO AI opened a new browser window');
  console.log('PHASE1 top-bar AI messenger drawer and chat state retention: PASS');
  // Phase 1 Home filtering is a real keyboard-operated tablist, not a
  // sequence of unreachable decorative pills.
  const homeFileFilters=page.getByRole('tablist',{name:'Filter recent files by type'});
  const allFilter=homeFileFilters.getByRole('tab',{name:'All',exact:true});
  await allFilter.focus();
  await page.keyboard.press('ArrowRight');
  const pdfFilter=homeFileFilters.getByRole('tab',{name:'PDF',exact:true});
  requireEvidence(await pdfFilter.getAttribute('aria-selected')==='true' &&
    await pdfFilter.evaluate(el=>document.activeElement===el),
    'Home file filter Right Arrow failed to select and focus PDF');
  await page.keyboard.press('End');
  const otherFilter=homeFileFilters.getByRole('tab',{name:'Other',exact:true});
  requireEvidence(await otherFilter.getAttribute('aria-selected')==='true',
    'Home file filter End failed');
  await page.keyboard.press('Home');
  requireEvidence(await allFilter.getAttribute('aria-selected')==='true' &&
    await allFilter.evaluate(el=>document.activeElement===el),
    'Home file filter Home failed to restore first tab');
  console.log('PHASE1 Home file filters accessible keyboard navigation: PASS');
  // The Settings page must provide exactly two real native radio controls.
  await openModule('Settings');
  await page.getByRole('heading',{name:'Appearance'}).waitFor({timeout:15000});
  requireEvidence(await page.getByRole('radio').count()===2,
    'Settings did not offer exactly Light and Dark');
  await page.getByRole('radio',{name:'Light'}).check();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  requireEvidence(await page.getByRole('radio',{name:'Light'}).isChecked(),
    'The Light preference radio did not update the running suite');
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  requireEvidence(await page.getByRole('radio',{name:'Dark'}).isChecked(),
    'The topbar theme switch did not synchronize the Settings selection');
  await openModule('Home');
  await page.getByRole('tab',{name:'Home',exact:true}).waitFor({timeout:15000});
  // Phase 1 command-palette acceptance: unsupported actions cannot be run
  // with Enter, and keyboard selection exposes a real ARIA active result.
  await page.keyboard.press('Control+k');
  const commandSearch=page.getByRole('combobox',{name:'Search MALENJO actions, documents and settings'});
  await commandSearch.waitFor({timeout:15000});
  await commandSearch.fill('Convert to Word');
  await page.getByRole('option',{name:/Convert to Word/}).waitFor({timeout:15000});
  requireEvidence(await page.getByRole('option',{name:/Convert to Word/}).isDisabled(),
    'Unverified PDF-to-Word command was executable in the global palette');
  await page.keyboard.press('ArrowDown');
  requireEvidence(await commandSearch.getAttribute('aria-activedescendant')===null,
    'Disabled-only palette results incorrectly received keyboard selection');
  await page.keyboard.press('Enter');
  requireEvidence(await page.getByRole('dialog',{name:'MALENJO command palette'}).isVisible(),
    'Enter executed a disabled command');
  await commandSearch.fill('Open Settings');
  await page.getByRole('option',{name:/Open Settings/}).waitFor({timeout:15000});
  requireEvidence(Boolean(await commandSearch.getAttribute('aria-activedescendant')),
    'Enabled command was not exposed through the accessible combobox');
  await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Appearance'}).waitFor({timeout:15000});
  await openModule('Home');
  await page.getByRole('tab',{name:'Home',exact:true}).waitFor({timeout:15000});
  console.log('PHASE1 keyboard command palette skips unavailable conversion and executes available settings: PASS');
  const topColor=await page.locator('.topbar').evaluate((node)=>getComputedStyle(node).backgroundColor);
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  const lightColor=await page.locator('.topbar').evaluate((node)=>getComputedStyle(node).backgroundColor);
  requireEvidence(lightColor!==topColor, 'Light theme did not change the top-bar rendered background');
  requireEvidence(await page.evaluate(()=>localStorage.getItem('malenjo:suite-theme:v1'))==='light',
    'Light preference was not saved');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Switch to dark theme'}).waitFor({timeout:15000});
  requireEvidence(await page.locator('.topbar').evaluate((node)=>getComputedStyle(node).backgroundColor)===lightColor,
    'The light appearance did not persist after reloading MALENJO');
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  requireEvidence(await page.locator('.topbar').evaluate((node)=>getComputedStyle(node).backgroundColor)===topColor,
    'The dark appearance failed to restore MALENJO colors');
  await page.getByRole('tab',{name:'PDF Viewer'}).click();
  await page.getByRole('tabpanel',{name:'PDF Viewer',exact:true})
    .getByRole('button',{name:'PDF Workspace'}).click();
  requireEvidence(await page.locator('main.workspace > .pdf-workspace').count()===1,
    'Ribbon PDF Viewer command did not navigate inside MALENJO');
  requireEvidence(await page.locator('.suite-ribbon').count()===0 &&
    await page.locator('main.workspace > .pdf-workspace .pdf-task-toolbar').isVisible(),
    'PDF workspace stacked two ribbons or lost its actual PDF task ribbon');
  requireEvidence(context.pages().length===1,'Ribbon navigation opened another window instead of the single workbench');
  await openModule('Home');
  await page.getByRole('tab',{name:'Home',exact:true}).waitFor({timeout:15000});
  requireEvidence(await page.locator('.suite-ribbon').count()===1,
    'Home did not restore the shared MALENJO ribbon');
  console.log('PHASE3 MALENJO ribbon Home/PDF and persistent light/dark appearance: PASS');

  // Phase 1 real keyboard-navigation contract. Arrow keys move among ribbon
  // categories, ArrowDown enters enabled commands, Escape returns to the tab.
  const homeRibbonTab=page.getByRole('tab',{name:'Home',exact:true});
  await homeRibbonTab.focus();
  await page.keyboard.press('ArrowRight');
  const pdfRibbonTab=page.getByRole('tab',{name:'PDF Viewer',exact:true});
  requireEvidence(await pdfRibbonTab.getAttribute('aria-selected')==='true',
    'Right arrow did not select the next ribbon category');
  await page.keyboard.press('ArrowDown');
  requireEvidence(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))==='Open PDF',
    'ArrowDown did not focus the first enabled ribbon command');
  await page.keyboard.press('Escape');
  requireEvidence(await pdfRibbonTab.evaluate((node)=>node===document.activeElement),
    'Escape did not restore focus to the selected ribbon category');
  await page.keyboard.press('End');
  requireEvidence(await page.getByRole('tab',{name:'Suite Tools'}).getAttribute('aria-selected')==='true',
    'End did not select the final ribbon category');
  await page.keyboard.press('Home');
  requireEvidence(await homeRibbonTab.getAttribute('aria-selected')==='true',
    'Home did not select the first ribbon category');

  // Resize the actual workbench in both MALENJO themes: controls must remain
  // reachable without topbar overflow or a secondary browser window.
  for(const theme of ['dark','light']){
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme){
      await page.getByRole('button',{name:theme==='light'?'Switch to light theme':'Switch to dark theme'}).click();
      await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
    }
    for(const width of [1024,800,680,430,320]){
      await page.setViewportSize({width,height:850});
      const metrics=await page.evaluate(()=>{
        const bar=document.querySelector('.topbar').getBoundingClientRect();
        const ribbon=document.querySelector('.suite-ribbon').getBoundingClientRect();
        const search=document.querySelector('.topbar .search').getBoundingClientRect();
        const commands=[...document.querySelectorAll('.topbar-actions button')].map((button)=>{
          const box=button.getBoundingClientRect();
          return {left:box.left,right:box.right,width:box.width};
        });
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
          bodyWidth:document.body.scrollWidth,barRight:bar.right,ribbonRight:ribbon.right,
          searchWidth:search.width,commands};
      });
      requireEvidence(metrics.documentWidth<=width+2 && metrics.bodyWidth<=width+2 &&
        metrics.barRight<=width+2 && metrics.ribbonRight<=width+2,
        'Shell or document horizontally overflows at '+width+'px in '+theme+' mode: '+JSON.stringify(metrics));
      requireEvidence(metrics.searchWidth>45 && metrics.commands.every((c)=>c.left>=0&&c.right<=width+2&&c.width>=30),
        'Essential titlebar commands clipped at '+width+'px in '+theme+' mode: '+JSON.stringify(metrics));
      requireEvidence(context.pages().length===1,'Responsive layout launched a second browser window');
    }
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  // A keyboard user can bypass the 22-module sidebar and reach the working area.
  await page.locator('.skip-to-workspace').focus();
  await page.keyboard.press('Enter');
  requireEvidence(await page.evaluate(()=>document.activeElement?.id)==='malenjo-workspace-content',
    'Skip navigation did not move keyboard focus to the active workspace');
  console.log('PHASE1 ribbon keyboard, resized layout, two-theme command access: PASS');


  // Phase 3: exercise every real navigation surface, not only the PDF tab.
  // This proves shell launchability, not the underlying domain workflows.
  const modulesText=readFileSync(resolve(root,'src/suite/modules/registry.ts'),'utf8');
  const sourceModules=Array.from(modulesText.matchAll(/\{\s*id:'[^']+',\s*name:'([^']+)'/g),match=>match[1]);
  const moduleNames=sourceModules.filter(name=>!['Document Workspace','Spreadsheet','Presentation','Malenjo AI'].includes(name));
  requireEvidence(sourceModules.length===22&&moduleNames.length===18&&new Set(moduleNames).size===18,
    'not all 18 user-facing tools are reachable from the top launcher');
  for(const name of moduleNames){
    await openModule(name);
    const entry=page.locator('.sidebar nav .nav-item').filter({hasText:name}).first();
    await page.waitForFunction(expected=>
      document.querySelector('.sidebar nav .nav-item.active')?.getAttribute('aria-label')===expected,
      name,{timeout:15000});
    requireEvidence(await entry.locator('.nav-glyph svg').count()===1 &&
      await entry.getAttribute('aria-label')===name,
      'Module navigation did not provide a real accessible icon: '+name);
    const content=(await page.locator('main.workspace').innerText()).trim();
    requireEvidence(content.length>15,
      'Workspace '+name+' has no usable page or clear capability status');
    requireEvidence(errors.length===0,
      'Unhandled error after navigating to '+name+': '+errors.join(' | '));
    console.log('PHASE3 module launch/navigation: '+name+' PASS (shell only)');
  }
  console.log('PHASE3 18/18 user-facing module shell-navigation smoke (22 registry entries): PASS (not module functionality sign-off)');
  // Release-oriented Phase 1: specialist screens must not share a generic
  // branded placeholder or expose nonfunctional editor commands as clickable.
  for(const [name,kind] of [
    ['CAD','cad'],['DICOM','dicom'],['Invoice Studio','invoice'],['Account','account'],
  ]){
    await openModule(name);
    const surface=page.locator('[data-capability-module="'+kind+'"]');
    await surface.waitFor({state:'visible',timeout:15000});
    requireEvidence(await surface.locator('.capability-inspector').isVisible() &&
      await surface.locator('.capability-canvas').isVisible(),
      'Missing contextual canvas/inspector for '+name);
    const commands=page.locator('.suite-ribbon-actions .suite-ribbon-action');
    await page.waitForFunction(()=>document.querySelectorAll('.suite-ribbon-actions .suite-ribbon-action:disabled').length===4);
    requireEvidence(await surface.locator('.capability-command-strip').count()===0 &&
      await page.locator('.suite-ribbon').count()===1 &&
      await commands.count()===6 &&
      await commands.filter({hasText:'Help'}).isEnabled() &&
      await commands.filter({hasText:'Files / Library'}).count()<=1 &&
      await page.locator('.suite-ribbon-actions .suite-ribbon-action:disabled').count()===4,
      'Specialist UI has duplicate ribbons or unsupported commands appear executable in '+name);
    requireEvidence(await surface.getByText('NOT RELEASE-READY').isVisible(),
      'Missing honest readiness status in '+name);
  }
  await page.locator('.suite-ribbon-actions').getByRole('button',{name:'Appearance settings'}).click();
  await page.getByRole('heading',{name:'Appearance'}).waitFor({timeout:15000});
  await openModule('CAD');
  await page.locator('.suite-ribbon-actions').getByRole('button',{name:'Files / Library',exact:true}).click();
  requireEvidence(await page.locator('.library-view').count()===1,
    'CAD Files command did not navigate to actual library');
  console.log('PHASE1 specialist CAD/DICOM/Invoice/Account honest desktop UI: PASS');


  // Theme overhaul: every workspace must render an actual neutral UI surface
  // in both themes. Photograph representative module views for human visual QA
  // instead of relying only on CSS source inspection.
  const themeProbes={
    'Home':'.ml-start-open',
    'Files / Library':'.library-toolbar',
    'PDF Workspace':'.pdf-task-toolbar',
    'Document Workspace':'.office-toolbar',
    'Spreadsheet':'.office-toolbar',
    'Presentation':'.office-toolbar',
    'Scanner':'.scanner-toolbar',
    'OCR':'.scanner-toolbar',
    'Malenjo AI':'.ai-toolbar',
    'Sign':'.security-toolbar',
    'Metadata Studio':'.security-toolbar',
    'Security Center':'.security-toolbar',
    'Automation Studio':'.enterprise-toolbar',
    'Enterprise DMS':'.enterprise-toolbar',
    'Administration':'.enterprise-toolbar',
    'Backup / DR':'.enterprise-toolbar',
    'Help / Support':'.help-panel',
    'Settings':'.appearance-panel',
    'CAD':'.capability-header',
    'DICOM':'.capability-header',
    'Invoice Studio':'.capability-header',
    'Account':'.capability-header',
  };
  // Release gate: no cherry-picked representative-only screenshots.
  // Capture EVERY registered module in BOTH MALENJO themes.
  const screenshotModules=new Set(moduleNames);
  let releaseGateScreenshotCount=0;
  const reviewDir=resolve(root,'.build/pdf-ui-browser/theme-review');
  mkdirSync(reviewDir,{recursive:true});
  const paletteEvidence={};
  for(const theme of ['dark','light']){
    const currentTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
    if(currentTheme!==theme){
      await page.getByRole('button',{name:theme==='light'?'Switch to light theme':'Switch to dark theme'}).click();
      await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,theme);
    }
    const accents=await page.evaluate(()=>{
      const style=getComputedStyle(document.documentElement);
      return [style.getPropertyValue('--ml-brand-blue').trim(),style.getPropertyValue('--ml-brand-cyan').trim()];
    });
    paletteEvidence[theme]=accents;
    requireEvidence(accents[0]==='#2b8cff'&&accents[1]==='#33d4e5',
      'MALENJO accent colors changed in '+theme+' mode');
    for(const name of moduleNames){
      await openModule(name);
      await page.waitForFunction(expected=>
        document.querySelector('.sidebar nav .nav-item.active')?.getAttribute('aria-label')===expected,name,{timeout:15000});
      const probe=themeProbes[name]??'.canvas-placeholder';
      const visible=page.locator('main.workspace').locator(probe).first();
      await visible.waitFor({state:'visible',timeout:15000});
      // Real computed-font audit across interactive elements in every module.
      // This catches CSS overrides missed by the source-level typography pass.
      const undersized=await page.locator('main.workspace').locator('button,input,select,textarea,label,[role="tab"]')
        .evaluateAll(elements=>elements.filter((element)=>{
          const bounds=element.getBoundingClientRect();
          const style=getComputedStyle(element);
          return bounds.width>8&&bounds.height>8&&
            style.display!=='none'&&style.visibility!=='hidden'&&
            Number.parseFloat(style.fontSize)<11;
        }).slice(0,8).map((element)=>({
          tag:element.tagName,name:(element.getAttribute('aria-label')||element.textContent||'').trim().slice(0,60),
          font:getComputedStyle(element).fontSize,
        })));
      requireEvidence(undersized.length===0,
        'Microscopic interactive labels in '+name+' / '+theme+': '+JSON.stringify(undersized));
      const bg=await visible.evaluate((element)=>getComputedStyle(element).backgroundColor);
      const rgb=bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      requireEvidence(Boolean(rgb),'Theme has no opaque panel background: '+name+' / '+theme+' ('+bg+')');
      const channels=rgb.slice(1,4).map(Number);
      requireEvidence(theme==='light'?Math.min(...channels)>155:Math.max(...channels)<115,
        name+' retained an unreadable '+(theme==='light'?'dark':'light')+' panel in '+theme+' mode: '+bg);
      if(screenshotModules.has(name)){
        const safe=name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
        await page.screenshot({path:join(reviewDir,theme+'-'+safe+'.png'),animations:'disabled',timeout:15000});
        releaseGateScreenshotCount++;
      }
      requireEvidence(errors.length===0,'Browser error during '+theme+' theme of '+name+': '+errors.join(' | '));
    }
    console.log('PHASE3 '+theme+' palette rendered in 18/18 public module shells: PASS (visual review pending)');
  }
  requireEvidence(releaseGateScreenshotCount===moduleNames.length*2,
    'Complete Light/Dark visual evidence missing some module views: '+releaseGateScreenshotCount);
  console.log('PHASE1 '+releaseGateScreenshotCount+' module appearance screenshots captured for HUMAN acceptance (not sign-off)');
  requireEvidence(JSON.stringify(paletteEvidence.dark)===JSON.stringify(paletteEvidence.light),
    'Brand colors were inconsistent between the two themes');
  await openModule('Home');
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  console.log('PHASE3 two-theme surface review and MALENJO brand parity: PASS');


  // Conversion-only Office editor rule: don't fake conversion provenance by
  // importing hand-authored DOCX/XLSX/PPTX files in the user-facing browser.
  // Low-level OOXML fidelity/edit/export regressions remain in Vitest;
  // real conversion->editor browser acceptance is still NOT RELEASE-READY.
  await openModule('Home');
  console.log('MALENJO loaded in Chromium; opening PDF via browser input');
  await page.locator('.workspace > input[type="file"]').setInputFiles({
    name:'browser-ui-acceptance.pdf',mimeType:'application/pdf',buffer:source,
  });
  const documentTab=page.locator('.document-tab-main').filter({hasText:'browser-ui-acceptance.pdf'});
  await documentTab.waitFor({timeout:30000});
  // The PDF viewer starts with no permanent navigation or inspector panes.
  const activePdf=page.locator('.document-session-panel.active');
  requireEvidence(await activePdf.locator('.pdf-layout.left-panel-collapsed.inspector-hidden').count()===1 &&
    await activePdf.locator('.pdf-left-shell').isHidden() &&
    await activePdf.locator('.pdf-inspector').count()===0,
    'PDF canvas started with an unwanted left or right sidebar');
  await page.getByRole('button',{name:'MALENJO AI',exact:true}).click();
  const sideBounds=await page.evaluate(()=>{
    const drawer=document.querySelector('.ml-ai-drawer.is-open')?.getBoundingClientRect();
    const work=document.querySelector('.document-session-stack')?.getBoundingClientRect();
    return {drawerLeft:drawer?.left??0,workRight:work?.right??0};
  });
  requireEvidence(sideBounds.workRight<=sideBounds.drawerLeft+2,
    'AI drawer overlapped the PDF workspace instead of sharing the window: '+JSON.stringify(sideBounds));
  await page.getByRole('button',{name:'Close MALENJO AI'}).click();
  for(const width of [1024,800,680,430]){
    await page.setViewportSize({width,height:830});
    const collision=await page.locator('.document-session-panel.active .pdf-context-toolbar')
      .evaluate(toolbar=>{
        const actions=toolbar.querySelector('.pdf-task-actions')?.getBoundingClientRect();
        const controls=toolbar.querySelector('.pdf-view-controls')?.getBoundingClientRect();
        const bounds=toolbar.getBoundingClientRect();
        return {actionsRight:actions?.right??0,controlsLeft:controls?.left??0,
          controlsRight:controls?.right??0,toolbarRight:bounds.right};
      });
    requireEvidence(collision.actionsRight<=collision.controlsLeft+3 &&
      collision.controlsRight<=collision.toolbarRight+3,
      'PDF buttons/panels overlap at '+width+'px: '+JSON.stringify(collision));
  }
  await page.setViewportSize({width:1440,height:900});
  console.log('MALENJO PDF icon ribbon non-overlap, hidden sidebars, side-chat coexistence: PASS');
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
  await openModule('Home');
  await documentTab.click();
  await page.locator('.pdf-page-shell canvas').first().waitFor({timeout:30000});
  requireEvidence(await documentTab.count()===1,'browser PDF tab vanished after navigation');
  console.log('MALENJO browser tab retention: PASS');
  // Also exercise the exact direct PDF Workspace -> Choose PDF path, which
  // previously opened a disposable preview that vanished on navigation.
  await openModule('PDF Workspace');
  await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
    .setInputFiles({
      name:'standalone-picker-keeps-tab.pdf',
      mimeType:'application/pdf',
      buffer:source,
    });
  const pickerTab=page.locator('.document-tab-main').filter({hasText:'standalone-picker-keeps-tab.pdf'});
  await pickerTab.waitFor({timeout:20000});
  await openModule('Home');
  await pickerTab.click();
  requireEvidence(await pickerTab.count()===1,
    'the PDF Workspace picker did not keep the opened document in a regular tab');
  console.log('MALENJO PDF Workspace Choose PDF tab retention: PASS');
  // Return to the original PDF to verify edit/export without altering it.
  await documentTab.click();
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:'Organize'}).click();
  await page.locator('.document-session-panel.active .pdf-context-toolbar').getByRole('button',{name:/Rotate selected/}).click();
  await page.waitForFunction(()=>
    Array.from(document.querySelectorAll('.pdf-notice')).some(
      node=>node.textContent?.includes('Permanently rotated'),
    ),null,{timeout:30000});
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:/^Home$/}).click();
  const pendingDownload=page.waitForEvent('download',{timeout:30000});
  await page.locator('.document-session-panel.active .pdf-context-toolbar').getByRole('button',{name:/^Export/}).click();
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
  await openModule('PDF Workspace');
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
