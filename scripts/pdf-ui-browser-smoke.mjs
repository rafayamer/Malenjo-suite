/* Real Chromium user-interface smoke: no mocked PDF rendering or downloads. */
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,StandardFonts} from 'pdf-lib';
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
  const coldHomeTiming=await page.evaluate(()=>{
    const nav=performance.getEntriesByType('navigation')[0];
    return nav ? Math.round(nav.domContentLoadedEventEnd-nav.startTime) : null;
  });
  console.log('PHASE1 measured cold Home DOMContentLoaded: '+coldHomeTiming+' ms (not a release budget)');
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
  requireEvidence(await page.locator('.ml-start-hero').getByRole('button',{name:'Open File',exact:true}).isVisible() &&
    await page.locator('.ml-start-hero').getByRole('button',{name:'Recent Files',exact:true}).isVisible(),
    'Minimal central Home Open File / Recent Files entry points are missing');
  requireEvidence(await page.locator('.ml-start-more-tools:not([open])').count()===1 &&
    await page.locator('.ml-start-utilities:not([open])').count()===1 &&
    await page.locator('#ml-home-recent-panel').isHidden(),
    'Home must initially show Open/Recent, not a permanent dashboard or recent list');
  requireEvidence(await page.locator('.ml-start-minimal').evaluate(node=>
    getComputedStyle(node).overflowY==='hidden' &&
    !node.textContent?.includes('Codespaces session')),
    'Home must be a fixed start screen without its own scrollbar or developer runtime disclaimer');
  requireEvidence(await page.getByRole('button',{name:'MALENJO AI',exact:true}).count()===1,
    'AI control missing from the top command bar');

  // UI/UX Phase 3: Home and PDF share one Windows-style ribbon shell.
  // Verify a real palette switch, persistence after reload and same-window
  // navigation rather than only checking the presence of a decorative toggle.
  await page.getByRole('tab',{name:'Home',exact:true}).waitFor({timeout:15000});
  // Master v2 Home: all ten canonical tabs and all 90 discoverable features.
  const ribbonCategories=await page.locator('.suite-ribbon-tabs [role="tab"]').allTextContents();
  requireEvidence(JSON.stringify(ribbonCategories.map(item=>item.trim()))===
    JSON.stringify(['Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools']),
    'Main ribbon does not match exact ten Master v2 categories');
  const galleryTrigger=page.getByRole('button',{name:'More PDF tools'});
  await galleryTrigger.click();
  const gallery=page.getByRole('dialog',{name:'All 90 PDF tools'});
  requireEvidence(await gallery.locator('[data-mal-command]').count()===90,
    'Home ribbon cannot discover all 90 features');
  const gallerySearch=gallery.getByRole('searchbox',{name:'Find a PDF tool'});
  await gallerySearch.fill('MAL-037');
  requireEvidence(await gallery.locator('[data-mal-command]').count()===1 &&
    await gallery.locator('[data-mal-command="MAL-037"] button').isDisabled(),
    'PDF to Word missing or executable without converter');
  await gallerySearch.fill('');
  await page.keyboard.press('Escape');
  requireEvidence(await gallery.count()===0 && await galleryTrigger.evaluate(el=>document.activeElement===el),
    'Feature flyout failed Escape/focus return');
  console.log('PHASE1 Home Master v2 ten-tab / 90 PDF features flyout: PASS');

  // Home is not an independent Word/Excel/PowerPoint opener. Those outputs
  // must originate from a successful PDF conversion (still a release blocker).
  await page.locator('.ml-start-utilities > summary').click();
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
  await aiDrawer.locator('.ai-composer textarea').waitFor({state:'visible',timeout:30000});
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
  const recentButton=page.locator('.ml-start-hero').getByRole('button',{name:'Recent Files',exact:true});
  await recentButton.click();
  requireEvidence(await recentButton.getAttribute('aria-expanded')==='true' &&
    await page.locator('#ml-home-recent-panel').isVisible(),
    'Recent Files did not open its real searchable document collection');
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
  // Master Specification v2.0: every MAL-001..MAL-090 is discoverable,
  // but searching it must NEVER make an unverified feature executable.
  for(const [requirement,label] of [['MAL-001','Merge PDF Files'],
      ['MAL-037','PDF to Word'],['MAL-063','Permanent PDF Redaction'],
      ['MAL-071','AI Chat with PDF'],['MAL-090','Advanced Print and Prepress']]){
    await commandSearch.fill(requirement);
    const option=page.getByRole('option',{name:new RegExp(label)}).first();
    await option.waitFor({timeout:15000});
    requireEvidence(await option.isDisabled() &&
      (await option.getAttribute('title'))?.includes('Not release-ready'),
      'Unverified '+requirement+' was missing from discovery or falsely executable');
  }
  console.log('MASTER v2: sample MAL-001 through MAL-090 searchable and safely disabled: PASS');
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
  await page.getByRole('tab',{name:'Home',exact:true}).click();
  await page.getByRole('tabpanel',{name:'Home',exact:true})
    .getByRole('button',{name:'PDF Viewer'}).click();
  await page.locator('main.workspace > .pdf-workspace .pdf-task-toolbar').waitFor({state:'visible',timeout:30000});
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
  const editRibbonTab=page.getByRole('tab',{name:'Edit',exact:true});
  requireEvidence(await editRibbonTab.getAttribute('aria-selected')==='true',
    'Right arrow did not select the next Master v2 ribbon category');
  await page.keyboard.press('ArrowDown');
  requireEvidence(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))==='PDF Workspace',
    'ArrowDown did not focus the first enabled Edit command');
  await page.keyboard.press('Escape');
  requireEvidence(await editRibbonTab.evaluate((node)=>node===document.activeElement),
    'Escape did not restore focus to selected Edit tab');
  await page.keyboard.press('End');
  requireEvidence(await page.getByRole('tab',{name:'Tools',exact:true}).getAttribute('aria-selected')==='true',
    'End did not select final Master v2 ribbon category');
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
        const commands=[...document.querySelectorAll('.topbar-actions button')]
          .filter(button=>getComputedStyle(button).display!=='none')
          .map(button=>{
            const box=button.getBoundingClientRect();
            return {left:box.left,right:box.right,width:box.width,
              label:button.getAttribute('aria-label')};
          });
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
          bodyWidth:document.body.scrollWidth,barRight:bar.right,ribbonRight:ribbon.right,
          searchWidth:search.width,commands};
      });
      requireEvidence(metrics.documentWidth<=width+2 && metrics.bodyWidth<=width+2 &&
        metrics.barRight<=width+2 && metrics.ribbonRight<=width+2,
        'Shell or document horizontally overflows at '+width+'px in '+theme+' mode: '+JSON.stringify(metrics));
      requireEvidence(metrics.searchWidth>45 && metrics.commands.every((c)=>c.left>=0&&c.right<=width+2&&c.width>=30) &&
        metrics.commands.some(c=>c.label==='MALENJO AI') &&
        metrics.commands.some(c=>c.label?.includes('Switch to')),
        'Visible titlebar commands clipped or AI/theme missing at '+width+'px in '+theme+' mode: '+JSON.stringify(metrics));
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
  // A scanner click must lead to genuine local-image/camera acquisition,
  // not a decorative launcher that cannot import or capture.
  await openModule('Scanner');
  const scanner=page.locator('.scanner-workspace');
  await scanner.getByRole('button',{name:/Open camera/}).waitFor({state:'visible',timeout:30000});
  requireEvidence(await scanner.getByRole('button',{name:/Choose images/}).isVisible(),
    'Scanner did not expose the actual local image picker at first use');
  const scanData=await page.evaluate(()=>{
    const surface=document.createElement('canvas');surface.width=600;surface.height=800;
    const ctx=surface.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,600,800);
    ctx.fillStyle='#000000';ctx.font='32px sans-serif';ctx.fillText('MALENJO SCAN TEST',42,120);
    return surface.toDataURL('image/png').split(',')[1];
  });
  await scanner.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name:'scanner-real-image.png',mimeType:'image/png',buffer:Buffer.from(scanData,'base64'),
  });
  await scanner.locator('.scan-pages > button').first().waitFor({state:'visible',timeout:30000});
  requireEvidence((await scanner.locator('.scan-pages > button').count())===1,
    'Scanner rejected valid generated image instead of creating a scan page');
  console.log('PHASE1 scanner real image import and visible camera/image acquisition: PASS');
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
    'Scanner':'.scanner-toolbar',
    'OCR':'.scanner-toolbar',
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
  console.log('MALENJO loaded in Chromium; opening PDF using the actual Home Open File button');
  const pdfFirstCanvasStarted=Date.now();
  // setInputFiles() on a hidden input bypasses the real button->picker wiring.
  // Owner acceptance must exercise what a Codespaces user actually clicks.
  const fileChooserPromise=page.waitForEvent('filechooser',{timeout:15000});
  await page.locator('.ml-start-hero').getByRole('button',{name:'Open File',exact:true}).click();
  const fileChooser=await fileChooserPromise;
  requireEvidence(fileChooser.isMultiple(),
    'Home Open File did not open the real multi-file browser picker');
  await fileChooser.setFiles({
    name:'browser-ui-acceptance.pdf',mimeType:'application/pdf',buffer:source,
  });
  const documentTab=page.locator('.document-tab-main').filter({hasText:'browser-ui-acceptance.pdf'});
  await documentTab.waitFor({timeout:30000});
  // The PDF viewer starts with no permanent navigation or inspector panes.
  const activePdf=page.locator('.document-session-panel.active');
  await activePdf.locator('.pdf-layout').waitFor({state:'visible',timeout:30000});
  // A canvas element may exist long before PDF.js has painted its pixels.
  // Assert an actual completed page render, not merely that React mounted
  // the viewer; this is the user-visible open-performance measurement.
  await page.waitForFunction(()=>{
    const root=document.querySelector('.document-session-panel.active .pdf-workspace');
    return root?.getAttribute('data-pdf-first-rendered')==='true' &&
      (root.querySelector('.pdf-page-shell canvas')?.width??0)>200;
  },null,{timeout:30000});
  console.log('PHASE1 measured two-page PDF first painted page: '+(Date.now()-pdfFirstCanvasStarted)+' ms (not a release budget)');
  // On large files PDF-lib form/annotation/bookmark/link metadata traversals
  // used to compete with the initial PDF.js canvas. They now start only
  // after page 1 has painted and the browser has received an idle opportunity.
  await page.waitForFunction(()=>
    document.querySelector('.document-session-panel.active .pdf-workspace')
      ?.getAttribute('data-pdf-secondary-inspection')==='ready',
    null,{timeout:30000});
  requireEvidence(await activePdf.locator('.pdf-page-shell canvas').first().isVisible(),
    'Deferred document inspection removed the readable first page');
  console.log('PHASE1 first real page painted before optional PDF structure inspection: PASS');
  requireEvidence(await activePdf.locator('.pdf-layout.left-panel-collapsed.inspector-hidden').count()===1 &&
    await activePdf.locator('.pdf-left-shell').isHidden() &&
    await activePdf.locator('.pdf-inspector').count()===0,
    'PDF canvas started with an unwanted left or right sidebar');
  await activePdf.getByRole('button',{name:'Show left document inspector'}).click();
  const inspectDock=await activePdf.locator('.pdf-layout').evaluate(node=>{
    const inspector=node.querySelector('.pdf-inspector')?.getBoundingClientRect();
    const reader=node.querySelector('.pdf-scroll')?.getBoundingClientRect();
    return {inspectorRight:inspector?.right??0,readerLeft:reader?.left??0};
  });
  requireEvidence(inspectDock.inspectorRight<=inspectDock.readerLeft+2,
    'Properties/form editor opened on the right instead of the LEFT: '+JSON.stringify(inspectDock));
  const dockResizer=activePdf.getByRole('separator',{name:'Resize document properties panel'});
  await dockResizer.waitFor({state:'visible',timeout:15000});
  const originalDockWidth=Number(await dockResizer.getAttribute('aria-valuenow'));
  await dockResizer.focus();
  await dockResizer.press('ArrowRight');
  requireEvidence(Number(await dockResizer.getAttribute('aria-valuenow'))===originalDockWidth+16,
    'Left inspector width did not respond to its keyboard separator');
  const splitter=await dockResizer.boundingBox();
  requireEvidence(Boolean(splitter),'Inspector drag/resize handle is not visible');
  await page.mouse.move(splitter.x+splitter.width/2,splitter.y+Math.min(60,splitter.height/2));
  await page.mouse.down();
  await page.mouse.move(splitter.x+splitter.width/2+40,splitter.y+Math.min(60,splitter.height/2),{steps:5});
  await page.mouse.up();
  requireEvidence(Number(await dockResizer.getAttribute('aria-valuenow'))>originalDockWidth+16,
    'Dragging the left dock separator did not resize the reader layout');
  await page.waitForFunction(()=>
    localStorage.getItem('malenjo:pdf-inspector-width-v1')===
    document.querySelector('.document-session-panel.active [aria-label="Resize document properties panel"]')?.getAttribute('aria-valuenow'),
    null,{timeout:15000});
  await activePdf.getByRole('button',{name:'Hide left document inspector'}).first().click();
  await activePdf.getByRole('button',{name:'Show document navigation'}).click();
  requireEvidence(await activePdf.getByRole('navigation',{name:'PDF navigation'})
    .getByRole('button',{name:'Bookmarks'}).isVisible(),
    'PDF left bookmarks navigation was invisible/unlabeled');
  const bookmarks=activePdf.getByRole('navigation',{name:'PDF navigation'}).getByRole('button',{name:'Bookmarks'});
  await bookmarks.focus();
  await bookmarks.press('Alt+ArrowDown');
  requireEvidence(await activePdf.getByRole('navigation',{name:'PDF navigation'})
    .locator('button').nth(2).getAttribute('aria-label')==='Bookmarks',
    'Keyboard/customizable left-panel order failed');
  await activePdf.getByRole('button',{name:'Hide document navigation'}).click();
  console.log('PHASE1 fixed Home and LEFT properties / labeled customizable navigation: PASS');

  // Phase 1: an icon-only ribbon that conceals its features is not acceptable.
  // Working actions have captions; planned conversions remain visible and
  // disabled, with a complete opt-in feature index rather than a side rail.
  await activePdf.getByRole('tab',{name:'Convert',exact:true}).click();
  const browseFeatures=activePdf.getByRole('button',{name:'Browse all PDF features'});
  await browseFeatures.click();
  const featureGrid=activePdf.getByRole('region',{name:'Convert PDF features'});
  await featureGrid.waitFor({state:'visible',timeout:15000});
  // Real conversion commands occupy the fixed ribbon first. Unverified
  // DOCX/XLSX/PPTX conversion remains visible (and disabled) in its flyout.
  for(const id of ['to-docx','to-xlsx','to-pptx']){
    const feature=featureGrid.locator('[data-pdf-feature="'+id+'"]');
    await feature.waitFor({state:'visible',timeout:15000});
    requireEvidence(await feature.locator('svg').count()===1 &&
      await feature.getByRole('button').isDisabled() &&
      (await feature.getAttribute('title')??'').includes('not release-ready'),
      'Unverified PDF conversion feature is unavailable or unexplained: '+id);
  }
  requireEvidence(await featureGrid.locator('.pdf-feature-gallery-cell').count()>=7 &&
    await featureGrid.locator('[data-pdf-feature="to-docx"] button').isDisabled() &&
    await featureGrid.locator('[data-pdf-feature="export-text"] button').isEnabled(),
    'PDF Features grid did not distinguish operational and unverified tools');

  // The user-facing feature index is a complete, searchable PDF suite
  // directory, never a separate Word/Excel/PowerPoint application menu.
  await featureGrid.getByRole('button',{name:'33 tool shortcuts'}).click();
  requireEvidence(await featureGrid.locator('[data-user-pdf-tool]').count()===33 &&
    await featureGrid.locator('.pdf-user-tool-group').count()===7,
    'User-visible PDF manipulation suite does not expose all 33 named tools in seven groups');
  const shortcutGlyphs=await featureGrid.locator('[data-user-pdf-tool] svg')
    .evaluateAll(nodes=>nodes.map(node=>node.getAttribute('class')??''));
  requireEvidence(shortcutGlyphs.length===33&&new Set(shortcutGlyphs).size===33,
    'The 33 PDF shortcut tiles repeat icons instead of having distinct meaningful glyphs');
  for(const id of ['pdf-to-word','pdf-to-excel','pdf-to-powerpoint','protect-pdf','redact-pdf']){
    requireEvidence(await featureGrid.locator('[data-user-pdf-tool="'+id+'"] button').isDisabled(),
      'Unaccepted conversion/security tool was incorrectly executable: '+id);
  }
  for(const id of ['merge-pdf','split-pdf','jpg-to-pdf','pdf-to-jpg']){
    requireEvidence(await featureGrid.locator('[data-user-pdf-tool="'+id+'"] svg').count()===1,
      'Named working PDF tool does not have a meaningful icon: '+id);
  }
  const toolSearch=featureGrid.getByRole('searchbox',{name:'Find PDF tool'});
  await toolSearch.fill('compress');
  requireEvidence(await featureGrid.locator('[data-user-pdf-tool]').count()===1 &&
    await featureGrid.locator('[data-user-pdf-tool="compress-pdf"] button').isDisabled(),
    'PDF feature search returned misleading results or enabled unverified compression');
  await toolSearch.fill('');
  await featureGrid.getByRole('button',{name:'All 90 PDF features'}).click();
  requireEvidence(await featureGrid.locator('[data-mal-command]').count()===90 &&
    await featureGrid.locator('[data-feature-index="MAL-001-MAL-090"]').count()===1,
    'Full MAL-001..MAL-090 PDF gallery is missing or incomplete');
  const masterGlyphs=await featureGrid.locator('[data-mal-command] svg')
    .evaluateAll(nodes=>nodes.map(node=>node.getAttribute('class')??''));
  requireEvidence(masterGlyphs.length===90&&new Set(masterGlyphs).size===90,
    'All 90 master PDF requirements must use UNIQUE, purpose-matched pictograms');
  for(const id of ['MAL-001','MAL-011','MAL-037','MAL-063','MAL-090']){
    requireEvidence(await featureGrid.locator('[data-mal-command="'+id+'"] button').isDisabled(),
      'Master v2 unverified command became executable: '+id);
  }
  const masterSearch=featureGrid.getByRole('searchbox',{name:'Find a MALENJO feature'});
  await masterSearch.fill('MAL-090');
  requireEvidence(await featureGrid.locator('[data-mal-command]').count()===1 &&
    await featureGrid.locator('[data-mal-command="MAL-090"]').count()===1,
    'MAL-090 could not be discovered through the PDF ribbon gallery');
  await masterSearch.fill('');
  await featureGrid.getByRole('button',{name:'Current ribbon'}).click();
  requireEvidence(await featureGrid.locator('[data-pdf-feature="export-text"]').count()===1,
    'Returning from all PDF tools lost the current ribbon actions');
  console.log('PHASE1 complete 33-tool, seven-group searchable PDF feature directory: PASS');
  await featureGrid.getByRole('button',{name:'Close PDF features'}).click();
  // This is a REAL two-page PDF-to-JPG conversion. Inspect the independent
  // downloaded ZIP and decode both JPEGs with Chromium (no mocked raster).
  const jpgTool=activePdf.locator('[data-pdf-feature="export-page-jpeg"] button');
  requireEvidence(await jpgTool.isEnabled(),'PDF-to-JPG was listed but not executable');
  const downloadPromise=page.waitForEvent('download',{timeout:60000});
  await jpgTool.click();
  const jpgDownload=await downloadPromise;
  requireEvidence(jpgDownload.suggestedFilename().endsWith('-pages-jpg.zip'),
    'PDF-to-JPG emitted the wrong file type: '+jpgDownload.suggestedFilename());
  const jpgPath=join(mkdtempSync(join(tmpdir(),'malenjo-pdf-to-jpg-')),'independent-pdf-to-jpg.zip');
  await jpgDownload.saveAs(jpgPath);
  const jpgFiles=unzipSync(new Uint8Array(readFileSync(jpgPath)));
  requireEvidence(JSON.stringify(Object.keys(jpgFiles))===JSON.stringify(['page-0001.jpg','page-0002.jpg']),
    'PDF-to-JPG skipped or reordered source pages');
  for(const [filename,jpgBytes] of Object.entries(jpgFiles)){
    const decoded=await page.evaluate(async base64=>{
      const image=new Image();
      image.src='data:image/jpeg;base64,'+base64;
      await image.decode();
      return {width:image.naturalWidth,height:image.naturalHeight};
    },Buffer.from(jpgBytes).toString('base64'));
    requireEvidence(jpgBytes[0]===0xff&&jpgBytes[1]===0xd8&&
      jpgBytes[jpgBytes.length-2]===0xff&&jpgBytes[jpgBytes.length-1]===0xd9&&
      decoded.width>700&&decoded.height>1000,
      'PDF-to-JPG output is not a decodable full-resolution page: '+filename);
  }
  console.log('PHASE1 real PDF-to-JPG two-page export, independent ZIP inspection and JPEG decoding: PASS');
  requireEvidence(await featureGrid.count()===0 &&
    await activePdf.locator('.pdf-page-shell canvas').first().isVisible(),
    'Feature gallery obscured or navigated away from the PDF');
  await activePdf.getByRole('tab',{name:'Protect',exact:true}).click();
  requireEvidence(await activePdf.locator('[data-pdf-feature="encrypt-pdf"] button').isDisabled(),
    'Password protection placeholder was missing or wrongly enabled');
  await activePdf.getByRole('tab',{name:'Home',exact:true}).click();
  console.log('PHASE1 PDF icon features, truthful conversion placeholders and opt-in catalog: PASS');

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
    const collision=await page.locator('.document-session-panel.active')
      .evaluate(panel=>{
        const toolbar=panel.querySelector('.pdf-context-toolbar')?.getBoundingClientRect();
        const actions=panel.querySelector('.pdf-task-actions')?.getBoundingClientRect();
        const readerFooter=panel.querySelector('.pdf-reader-footer')?.getBoundingClientRect();
        const controls=panel.querySelector('.pdf-reader-footer .pdf-view-controls')?.getBoundingClientRect();
        const galleryButton=panel.querySelector('.pdf-feature-index-trigger')?.getBoundingClientRect();
        return {actionsRight:actions?.right??0,toolbarRight:toolbar?.right??0,
          readerFooterRight:readerFooter?.right??0,controlsRight:controls?.right??0,
          footerWidth:readerFooter?.width??0,featureVisible:Boolean(galleryButton?.width)};
      });
    requireEvidence(collision.actionsRight<=collision.toolbarRight+3 &&
      collision.controlsRight<=collision.readerFooterRight+3 &&
      collision.footerWidth>0 && collision.featureVisible,
      'PDF ribbon/footer overflow or PDF features hidden at '+width+'px: '+JSON.stringify(collision));
  }
  await page.setViewportSize({width:1440,height:900});
  console.log('MALENJO PDF icon ribbon non-overlap, hidden sidebars, side-chat coexistence: PASS');
  console.log('MALENJO browser document tab opened');
  await page.waitForFunction(()=>
    Array.from(document.querySelectorAll('.document-session-panel.active .pdf-text-layer span')).some(
      node=>node.textContent?.includes('MALENJO BROWSER UI TEXT SELECT FIND'),
    ),null,{timeout:30000});
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.document-session-panel.active .pdf-text-layer span')].some(node =>
      node.isConnected &&
      node.textContent?.includes('MALENJO BROWSER UI TEXT SELECT FIND') &&
      getComputedStyle(node).cursor==='text'
    ),null,{timeout:30000});
  const span=page.locator('.document-session-panel.active .pdf-text-layer span')
    .filter({hasText:'MALENJO BROWSER UI TEXT SELECT FIND'}).first();
  // Exercise a real pointer hit on the active document; an unrelated parked
  // PDF layer can finish rendering independently and must not satisfy this gate.
  await span.hover({timeout:20000});
  console.log('MALENJO real PDF.js selectable text spans rendered with working I-beam');
  const selected=await span.evaluate(node=>{
    const range=document.createRange(),selection=window.getSelection();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const text=selection?.toString()??'';
    selection?.removeAllRanges();
    const box=node.getBoundingClientRect();
    const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    return {cursor:getComputedStyle(node).cursor,
      hitCursor:hit?getComputedStyle(hit).cursor:'none',selection:text,
      connected:node.isConnected,parentClass:node.parentElement?.className??'',
      className:node.className,tag:node.tagName,html:node.outerHTML.slice(0,350),
      candidates:[...document.querySelectorAll('.document-session-panel.active .pdf-text-layer span')]
        .filter(item=>item.textContent?.includes('MALENJO BROWSER UI TEXT SELECT FIND'))
        .slice(0,5).map(item=>({tag:item.tagName,className:item.className,
          cursor:getComputedStyle(item).cursor,connected:item.isConnected,
          parentClass:item.parentElement?.className??''}))};
  });
  requireEvidence(selected.connected && selected.cursor==='text' && selected.hitCursor==='text',
    'PDF hover does not show I-beam on active page: '+JSON.stringify(selected));
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
  // Master v2 bottom status must be driven by the active PDF reader, not a
  // constant "working copy" badge. Exercise zoom and actual page numbers.
  const liveStatus=page.locator('.ml-bottom-statusbar .ml-status-pdf-view');
  const readerNavigation=activePdf.locator('.pdf-reader-footer .pdf-page-nav');
  await readerNavigation.waitFor({state:'visible',timeout:15000});
  requireEvidence(await page.locator('.ml-bottom-statusbar').isHidden(),
    'Open PDF still displays a duplicate shell status footer beneath the reader');
  requireEvidence(/Page [12] \/ 2 · Fit width/.test(await liveStatus.textContent()??''),
    'Hidden shell page/zoom state lost synchronization with the real PDF reader');
  requireEvidence(await activePdf.locator('.pdf-reader-footer input[aria-label="Current PDF page"]').isVisible(),
    'The sole PDF reader footer does not expose operational page navigation');
  await page.getByRole('button',{name:'Actual size'}).click();
  await page.waitForFunction(()=>
    document.querySelector('.ml-bottom-statusbar .ml-status-pdf-view')?.textContent?.includes('100%'),
    null,{timeout:15000});
  await page.getByRole('button',{name:'Zoom mode: 100%'}).click();
  await page.waitForFunction(()=>
    document.querySelector('.ml-bottom-statusbar .ml-status-pdf-view')?.textContent?.includes('Fit width'),
    null,{timeout:15000});
  console.log('PHASE1 live PDF page count and real zoom mode in compact status bar: PASS');
  // Regression for the owner's real-world defect: the *same* PDF must scroll
  // through multiple pages; page navigation and zoom are no longer in the ribbon.
  const readerFooter=activePdf.locator('.pdf-reader-footer');
  requireEvidence(await readerFooter.getByRole('button',{name:'Rotate current PDF page clockwise (saved edit)'}).isVisible(),
    'Saved PDF rotation must be discoverable in the viewer footer');
  await activePdf.getByRole('tab',{name:'Organize',exact:true}).click();
  requireEvidence(await activePdf.getByRole('spinbutton',{name:'Page number to edit'}).isVisible(),
    'Organize must explicitly show the target page selector');
  requireEvidence(await activePdf.locator('[data-pdf-feature="turn-pages"] button').count()===0,
    'Duplicate Rotate command must be removed from Organize');
  await activePdf.getByRole('tab',{name:'Home',exact:true}).click();
  const reader=activePdf.locator('.pdf-scroll');
  const scrollSizes=await reader.evaluate(node=>({height:node.clientHeight,scrollHeight:node.scrollHeight}));
  requireEvidence(scrollSizes.scrollHeight>scrollSizes.height+200,
    'Continuous multi-page PDF does not provide vertical document scrolling: '+JSON.stringify(scrollSizes));
  await reader.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 2 / 2'),
    null,{timeout:15000});
  await readerFooter.getByRole('button',{name:'Previous page'}).click();
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 1 / 2'),
    null,{timeout:15000});
  const range=readerFooter.getByRole('slider',{name:'PDF zoom percentage'});
  await range.focus();
  await range.press('End');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('400%'),
    null,{timeout:15000});
  await readerFooter.getByRole('button',{name:'Actual size'}).click();
  const pdfKeyboard=activePdf.locator('.pdf-scroll');
  await pdfKeyboard.focus();
  await pdfKeyboard.press('0');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('100%'),
    null,{timeout:15000});
  await pdfKeyboard.press('+');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('110%'),
    null,{timeout:15000});
  await pdfKeyboard.evaluate(node=>node.dispatchEvent(new WheelEvent('wheel',{
    deltaY:-120,ctrlKey:true,bubbles:true,cancelable:true,
  })));
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('120%'),
    null,{timeout:15000});
  await pdfKeyboard.press('w');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Fit width'),
    null,{timeout:15000});
  await pdfKeyboard.press('PageDown');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 2 / 2'),
    null,{timeout:15000});
  await pdfKeyboard.press('PageUp');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 1 / 2'),
    null,{timeout:15000});
  // Presentation owns the entire PDF fullscreen surface. A viewer should
  // be able to navigate and Escape without getting stranded in single-page.
  await readerFooter.getByRole('button',{name:'Presentation mode'}).click();
  await page.waitForFunction(()=>
    Boolean(document.fullscreenElement) &&
    Boolean(document.querySelector('.document-session-panel.active .pdf-workspace.presentation-mode')),
    null,{timeout:15000});
  requireEvidence(await readerFooter.isHidden() &&
    await activePdf.locator('.pdf-stage.single').isVisible(),
    'Presentation did not enter true chrome-free fullscreen single-page mode');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(()=>
    document.querySelector('.document-session-panel.active input[aria-label="Current PDF page"]')?.value==='2',
    null,{timeout:15000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>
    !document.fullscreenElement &&
    !document.querySelector('.document-session-panel.active .pdf-workspace.presentation-mode'),
    null,{timeout:15000});
  requireEvidence(await readerFooter.isVisible() &&
    await activePdf.locator('.pdf-stage.continuous').isVisible(),
    'Exiting presentation failed to restore continuous reading mode and footer');
  console.log('PHASE1 genuine fullscreen PDF presentation, page turn and Escape restore: PASS');
  console.log('PHASE1 real multipage scroll + reader footer + keyboard and wheel zoom: PASS');

  // Master v2 Phase 1 responsive + appearance matrix on a REAL open PDF.
  // Keep PDF.js selectable text functional through live theme changes,
  // viewport resizing and opening/closing the document AI drawer.
  const viewportMatrix=[[1920,1080],[1440,900],[1366,768],[1024,768],[768,600],[430,720]];
  const topAi=page.getByRole('button',{name:'MALENJO AI',exact:true});
  for (const expectedTheme of ['light','dark']) {
    const initialTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
    if(initialTheme!==expectedTheme) {
      await page.getByRole('button',{
        name:expectedTheme==='light'?'Switch to light theme':'Switch to dark theme',
      }).click();
    }
    await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,
      expectedTheme,{timeout:15000});
    for (const [width,height] of viewportMatrix) {
      await page.setViewportSize({width,height});
      const dimensions=await page.evaluate(()=>{
        const rect=(selector)=>{
          const bounds=document.querySelector(selector)?.getBoundingClientRect();
          return bounds?{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom}:null;
        };
        return {
          viewport:innerWidth, documentWidth:document.documentElement.scrollWidth,
          ai:rect('.ml-top-ai'),
          ribbon:rect('.document-session-panel.active .pdf-task-categories'),
          status:rect('.ml-bottom-statusbar'),
          pdfToolbar:rect('.document-session-panel.active .pdf-context-toolbar'),
        };
      });
      requireEvidence(dimensions.ai && dimensions.ai.left>=-1 &&
        dimensions.ai.right<=width+2 &&
        dimensions.ribbon && dimensions.ribbon.right<=width+2 &&
        dimensions.status && dimensions.status.right<=width+2 &&
        dimensions.pdfToolbar && dimensions.pdfToolbar.right<=width+2 &&
        dimensions.documentWidth<=width+2,
        'Phase 1 '+expectedTheme+' viewport '+width+'x'+height+
        ' clips global/PDF controls or overflows the window: '+JSON.stringify(dimensions));
      await page.screenshot({path:resolve(root,
        '.build/pdf-ui-browser/theme-review/phase1-pdf-'+expectedTheme+'-'+width+'x'+height+'.png')});
    }
    await page.setViewportSize({width:1440,height:900});
    // Selectable text must survive the actual theme change and optional AI.
    for (const drawerOpen of [true,false]) {
      if(drawerOpen)await topAi.click();
      else await page.getByRole('button',{name:'Close MALENJO AI'}).click();
      await page.waitForFunction(()=>
        [...document.querySelectorAll('.document-session-panel.active .pdf-text-layer span')]
          .some(node=>node.isConnected &&
            node.textContent?.includes('MALENJO BROWSER UI TEXT SELECT FIND') &&
            getComputedStyle(node).cursor==='text'),
      null,{timeout:30000});
      const activeText=page.locator('.document-session-panel.active .pdf-text-layer span')
        .filter({hasText:'MALENJO BROWSER UI TEXT SELECT FIND'}).first();
      // Playwright performs a real Chromium mouse hover over the PDF text,
      // rather than testing only an isolated CSS selector in a unit test.
      await activeText.hover({timeout:20000});
      const interaction=await activeText.evaluate(node=>{
        const rect=node.getBoundingClientRect();
        const target=document.elementFromPoint(rect.left+rect.width/2,
          rect.top+rect.height/2);
        return {spanCursor:getComputedStyle(node).cursor,
          hitCursor:target?getComputedStyle(target).cursor:'none',
          connected:node.isConnected};
      });
      requireEvidence(interaction.connected && interaction.spanCursor==='text' &&
        interaction.hitCursor==='text',
        'PDF lost real text-hover cursor with '+expectedTheme+
        ' theme and AI '+(drawerOpen?'open':'closed')+': '+JSON.stringify(interaction));
    }
  }
  await page.setViewportSize({width:1440,height:900});
  console.log('PHASE1 real PDF, two themes, six viewport sizes, AI drawer and I-beam hover matrix: PASS');

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
  // Return to the original PDF and verify top-bar actions are genuine
  // document-controller commands with honest disabled history state.
  await documentTab.click();
  // The presentation test just navigated to page 2. Page rotation operates
  // on the explicitly selected page, not implicitly on the first document
  // page; navigate back to page 1 and verify selection before editing.
  const pageSelector=page.locator('.document-session-panel.active .pdf-reader-footer input[aria-label="Current PDF page"]');
  await pageSelector.fill('1');
  await pageSelector.press('Enter');
  await page.waitForFunction(()=>
    document.querySelector('.document-session-panel.active [aria-label="Pages selected for editing: 1"]')!==null,
    null,{timeout:15000});
  const saveQuick=page.getByRole('button',{name:'Save PDF copy',exact:true});
  const undoQuick=page.getByRole('button',{name:'Undo PDF edit',exact:true});
  const redoQuick=page.getByRole('button',{name:'Redo PDF edit',exact:true});
  requireEvidence(await saveQuick.isEnabled() &&
    await undoQuick.isDisabled() && await redoQuick.isDisabled(),
    'Top-bar Save / Undo / Redo did not reflect the unedited live PDF');
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:'Organize'}).click();
  await readerFooter.getByRole('button',{name:'Rotate current PDF page clockwise (saved edit)'}).click();
  await page.waitForFunction(()=>
    Array.from(document.querySelectorAll('.pdf-notice')).some(
      node=>node.textContent?.includes('Permanently rotated'),
    ),null,{timeout:30000});
  await page.waitForFunction(()=>
    [...document.querySelectorAll('.topbar-quick-history')].some(node=>
      node.getAttribute('aria-label')==='Undo PDF edit' && !node.disabled),
  null,{timeout:15000});
  requireEvidence(await undoQuick.isEnabled() && await redoQuick.isDisabled(),
    'Real PDF rotation did not enable Undo and keep Redo disabled');
  await undoQuick.click();
  await page.waitForFunction(()=>
    [...document.querySelectorAll('.pdf-notice')].some(node=>node.textContent?.includes('Undid:')),
  null,{timeout:30000});
  await page.waitForFunction(()=>
    [...document.querySelectorAll('.topbar-quick-history')].some(node=>
      node.getAttribute('aria-label')==='Redo PDF edit' && !node.disabled),
  null,{timeout:15000});
  requireEvidence(await redoQuick.isEnabled(),
    'Undo did not produce a redo-able PDF history state');
  await redoQuick.click();
  await page.waitForFunction(()=>
    [...document.querySelectorAll('.pdf-notice')].some(node=>node.textContent?.includes('Redid:')),
  null,{timeout:30000});
  const quickDownloadPromise=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const quickDownload=await quickDownloadPromise;
  const quickPath=join(mkdtempSync(join(tmpdir(),'malenjo-topbar-save-')),'saved-copy.pdf');
  await quickDownload.saveAs(quickPath);
  const quickPdf=await PDFDocument.load(readFileSync(quickPath));
  requireEvidence(quickPdf.getPageCount()===2&&quickPdf.getPage(0).getRotation().angle===90,
    'Top-bar Save PDF copy did not export the redone real PDF mutation');
  console.log('PHASE1 real top-bar Save/Undo/Redo and saved-PDF independent reopen: PASS');
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:/^Edit$/}).click();
  requireEvidence(await page.locator('.document-session-panel.active .pdf-context-toolbar [data-pdf-feature="undo"]').count()===0 &&
    await page.locator('.document-session-panel.active .pdf-context-toolbar [data-pdf-feature="redo"]').count()===0 &&
    await page.locator('.document-session-panel.active .pdf-context-toolbar [data-pdf-feature="place-text"]').count()===1,
    'Edit ribbon repeated topbar Undo/Redo or hid actual editing tools');
  await page.locator('.document-session-panel.active .pdf-task-categories button').filter({hasText:/^Home$/}).click();
  requireEvidence(await page.locator('.document-session-panel.active .pdf-context-toolbar [data-pdf-feature="export"]').count()===0,
    'Save was duplicated in the PDF Home ribbon and top bar');
  const pendingDownload=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
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
  // Phase 2: Replace one selected PDF page through the REAL Organize button
  // and file chooser. Verify saved bytes in an independent pdf-lib reader,
  // preserving page count/neighbor content, original, Undo and Redo.
  const replacementSource=await PDFDocument.create();
  const replacementPage=replacementSource.addPage([690,720]);
  replacementPage.drawText('MALENJO PHASE 2 REPLACEMENT PAGE',{x:40,y:610,size:18});
  const replacementBytes=Buffer.from(await replacementSource.save({useObjectStreams:false}));
  await activePdf.getByRole('tab',{name:'Organize',exact:true}).click();
  const replacementButton=activePdf.locator('[data-pdf-feature="replace-page"] button');
  await replacementButton.waitFor({state:'visible',timeout:15000});
  requireEvidence(await replacementButton.isEnabled(),
    'Organize did not offer safe single-page replacement with page 1 selected');
  const replacementChooserWait=page.waitForEvent('filechooser',{timeout:15000});
  await replacementButton.click();
  const replacementChooser=await replacementChooserWait;
  requireEvidence(!replacementChooser.isMultiple(),
    'Replace page must import exactly one PDF, not an uncontrolled file batch');
  let approvedReplacement=false;
  page.once('dialog',async dialog=>{
    approvedReplacement=dialog.type()==='confirm'&&dialog.message().includes('Replace page 1');
    await dialog.accept();
  });
  await replacementChooser.setFiles({
    name:'phase2-replacement.pdf',mimeType:'application/pdf',buffer:replacementBytes,
  });
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Replaced page 1')),null,{timeout:30000});
  requireEvidence(approvedReplacement,
    'Replacement did not require an explicit human confirmation');
  const replacementDownloadWait=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const replacementDownload=await replacementDownloadWait;
  const replacementPath=join(mkdtempSync(join(tmpdir(),'malenjo-replace-')),'replaced.pdf');
  await replacementDownload.saveAs(replacementPath);
  const replacementResult=await PDFDocument.load(readFileSync(replacementPath));
  requireEvidence(replacementResult.getPageCount()===2&&
    replacementResult.getPage(0).getWidth()===690&&
    replacementResult.getPage(1).getWidth()===500,
    'Replace page UI did not export one real imported page in its original page order');
  await undoQuick.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Undid: Replaced page 1')),null,{timeout:30000});
  const undoDownloadWait=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const undoDownload=await undoDownloadWait;
  const undoPath=join(mkdtempSync(join(tmpdir(),'malenjo-replace-undo-')),'undone.pdf');
  await undoDownload.saveAs(undoPath);
  const undoResult=await PDFDocument.load(readFileSync(undoPath));
  requireEvidence(undoResult.getPageCount()===2&&
    undoResult.getPage(0).getWidth()===500&&
    undoResult.getPage(0).getRotation().angle===90,
    'Replace-page Undo did not restore the prior rotated working PDF');
  await redoQuick.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Redid: Replaced page 1')),null,{timeout:30000});
  const redoDownloadWait=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const redoDownload=await redoDownloadWait;
  const redoPath=join(mkdtempSync(join(tmpdir(),'malenjo-replace-redo-')),'redone.pdf');
  await redoDownload.saveAs(redoPath);
  const redoResult=await PDFDocument.load(readFileSync(redoPath));
  requireEvidence(redoResult.getPageCount()===2&&
    redoResult.getPage(0).getWidth()===690&&
    redoResult.getPage(1).getWidth()===500&&
    (await PDFDocument.load(source)).getPage(0).getWidth()===500,
    'Replace-page Redo damaged page order or modified the source bytes');
  console.log('PHASE2 real PDF page replacement, independent Save/Undo/Redo reopen and original preservation: PASS');
  // Portable visual annotations must survive the REAL Organize picker,
  // confirmation, working preview and independently reopened download.
  const annotationImport=await PDFDocument.create();
  const importedPage=annotationImport.addPage([690,720]);
  importedPage.drawText('ANNOTATED REPLACEMENT',{x:44,y:610,size:18});
  const importedNote=annotationImport.context.register(annotationImport.context.obj({
    Type:PDFName.of('Annot'),Subtype:PDFName.of('Text'),Rect:[35,35,65,65],
    Contents:PDFHexString.fromText('Preserved visual annotation'),P:importedPage.ref,
  }));
  importedPage.node.set(PDFName.of('Annots'),annotationImport.context.obj([importedNote]));
  const annotatedBytes=Buffer.from(await annotationImport.save({useObjectStreams:false}));
  const annotatedChooserWait=page.waitForEvent('filechooser',{timeout:15000});
  await replacementButton.click();
  const annotatedChooser=await annotatedChooserWait;
  page.once('dialog',async dialog=>{await dialog.accept();});
  await annotatedChooser.setFiles({
    name:'annotated-import.pdf',mimeType:'application/pdf',buffer:annotatedBytes,
  });
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Replaced page 1 with page 1 from annotated-import.pdf')),null,{timeout:30000});
  const annotatedWait=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const annotatedDownload=await annotatedWait;
  const annotatedPath=join(mkdtempSync(join(tmpdir(),'malenjo-annotated-import-')),'annotated.pdf');
  await annotatedDownload.saveAs(annotatedPath);
  const annotatedReopened=await PDFDocument.load(readFileSync(annotatedPath));
  const reopenedAnnotationArray=annotatedReopened.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
  requireEvidence(reopenedAnnotationArray.size()===1,
    'Annotated page replacement lost a real imported annotation');
  const reopenedNote=annotatedReopened.context.lookup(reopenedAnnotationArray.get(0),PDFDict);
  requireEvidence(reopenedNote.get(PDFName.of('Subtype'))?.toString()==='/Text' &&
    reopenedNote.get(PDFName.of('P'))?.toString()===annotatedReopened.getPage(0).ref.toString(),
    'Imported PDF annotation lost its subtype or page reference on independent reopen');
  await undoQuick.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Undid: Replaced page 1 with page 1 from annotated-import.pdf')),null,{timeout:30000});
  console.log('PHASE2 portable annotated PDF replacement from real file picker and reopened PDF: PASS');

  // Owner UAT follow-up: visibly select a page, draw a crop in the live
  // canvas with measured margins, apply, export/reopen, and Undo the crop.
  const targetPicker=activePdf.getByRole('spinbutton',{name:'Page number to edit'});
  await targetPicker.fill('1');
  await targetPicker.press('Tab');
  const cropButton=activePdf.locator('[data-pdf-feature="open-crop-settings"] button');
  await cropButton.click();
  const cropOverlay=activePdf.locator('[data-pdf-crop-overlay="1"]');
  await cropOverlay.waitFor({state:'visible',timeout:30000});
  const box=await cropOverlay.boundingBox();
  requireEvidence(Boolean(box)&&box.width>200&&box.height>200,'Live visual crop overlay had no usable canvas area');
  await page.mouse.move(box.x+box.width*.15,box.y+box.height*.12);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.80,box.y+box.height*.88,{steps:8});
  await page.mouse.up();
  const leftMargin=activePdf.getByRole('spinbutton',{name:'Crop left in mm'});
  await page.waitForFunction(()=>Number(document.querySelector('.document-session-panel.active input[aria-label="Crop left in mm"]')?.value)>1,null,{timeout:15000});
  requireEvidence(Number(await leftMargin.inputValue())>1,'Crop drag did not update measured margins');
  await activePdf.getByRole('button',{name:/Apply crop to 1 page/}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Crop applied')),null,{timeout:30000});
  const croppedWait=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const croppedDownload=await croppedWait;
  const croppedPath=join(mkdtempSync(join(tmpdir(),'malenjo-visual-crop-')),'crop.pdf');
  await croppedDownload.saveAs(croppedPath);
  const croppedPdf=await PDFDocument.load(readFileSync(croppedPath));
  requireEvidence(croppedPdf.getPage(0).getCropBox().width<croppedPdf.getPage(0).getMediaBox().width,
    'Live dragged crop was not persisted in a separately reopened PDF');
  await undoQuick.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Undid: Updated crop box')),null,{timeout:30000});
  // Deletion and Undo must restore the *real* document structure in-memory.
  page.once('dialog',async dialog=>{await dialog.accept();});
  await activePdf.locator('[data-pdf-feature="remove-pages"] button').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Removed 1 page')),null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.document-session-panel.active input[aria-label="Current PDF page"]')?.value==='1' &&
    [...document.querySelectorAll('.document-session-panel.active .pdf-inspector dt')].some(item=>item.textContent==='Pages'&&item.nextElementSibling?.textContent==='1'),
    null,{timeout:30000});
  await undoQuick.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Undid: Removed 1 page')),null,{timeout:30000});
  const restoredWait=page.waitForEvent('download',{timeout:30000});
  await saveQuick.click();
  const restoredDownload=await restoredWait;
  const restoredPath=join(mkdtempSync(join(tmpdir(),'malenjo-delete-undo-')),'restored.pdf');
  await restoredDownload.saveAs(restoredPath);
  const restoredPdf=await PDFDocument.load(readFileSync(restoredPath));
  requireEvidence(restoredPdf.getPageCount()===2 && restoredPdf.getPage(0).getWidth()===690,
    'Delete/Undo did not restore two intact pages in independent reopen');
  console.log('PHASE2 visual crop with measured margins and real Delete/Undo independently reopened: PASS');


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

  // Owner's real-world PDF had 57 pages. A two-page-only smoke is insufficient:
  // verify page 55 and final page in ONE continuous document, not 57 tabs.
  const longPdf=await PDFDocument.create();
  for(let i=1;i<=57;i++){
    const longPage=longPdf.addPage([612,792]);
    longPage.drawText('MALENJO multipage acceptance '+i,{x:48,y:728,size:18});
  }
  const longPdfBytes=Buffer.from(await longPdf.save());
  await openModule('PDF Workspace');
  const longLoadStarted=Date.now();
  await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
    .setInputFiles({name:'57-pages-long-reading.pdf',mimeType:'application/pdf',buffer:longPdfBytes});
  await page.locator('.document-tab-main').filter({hasText:'57-pages-long-reading.pdf'})
    .waitFor({timeout:30000});
  const longReader=page.locator('.document-session-panel.active .pdf-scroll');
  await longReader.waitFor({state:'visible',timeout:30000});
  console.log('PHASE1 measured 57-page PDF reader startup: '+(Date.now()-longLoadStarted)+' ms (no performance budget assumed)');
  const longScrollDimensions=await longReader.evaluate(node=>({client:node.clientHeight,total:node.scrollHeight}));
  requireEvidence(longScrollDimensions.total>longScrollDimensions.client*10,
    '57-page PDF is not a continuous vertically scrollable document: '+JSON.stringify(longScrollDimensions));
  const longInput=page.locator('.document-session-panel.active input[aria-label="Current PDF page"]');
  await longInput.fill('55');
  await longInput.press('Enter');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 55 / 57'),
    null,{timeout:30000});
  await page.waitForFunction(()=>{
    const canvas=document.querySelector('.document-session-panel.active [id$="-page-55"] canvas');
    return canvas instanceof HTMLCanvasElement&&canvas.width>200;
  },null,{timeout:30000});
  await longInput.fill('57');
  await longInput.press('Enter');
  await page.waitForFunction(()=>
    document.querySelector('.ml-status-pdf-view')?.textContent?.includes('Page 57 / 57'),
    null,{timeout:30000});
  await page.waitForFunction(()=>{
    const canvas=document.querySelector('.document-session-panel.active [id$="-page-57"] canvas');
    return canvas instanceof HTMLCanvasElement&&canvas.width>200;
  },null,{timeout:30000});
  console.log('PHASE1 real 57-page continuous PDF navigation and last-page rendering: PASS');
  // Phase 2: a real button duplicates the current page in the original
  // document, with distinct page refs and independently reopened export.
  const duplicateSource=await PDFDocument.create();
  duplicateSource.addPage([440,640]).drawText('DUPLICATE THIS PAGE',{x:30,y:590,size:16});
  duplicateSource.addPage([460,640]).drawText('KEEP THIS PAGE',{x:30,y:590,size:16});
  duplicateSource.setTitle('Keep catalog metadata');
  const duplicateOriginalBytes=Buffer.from(await duplicateSource.save({useObjectStreams:false}));
  await openModule('PDF Workspace');
  await page.locator('main.workspace > .pdf-workspace > input[type="file"][accept="application/pdf,.pdf"]').first()
    .setInputFiles({name:'phase2-duplicate-test.pdf',mimeType:'application/pdf',buffer:duplicateOriginalBytes});
  await page.locator('.document-tab-main').filter({hasText:'phase2-duplicate-test.pdf'}).waitFor({timeout:30000});
  const duplicationUi=page.locator('.document-session-panel.active .pdf-workspace');
  await duplicationUi.getByRole('tab',{name:'Organize',exact:true}).click();
  const duplicateCommand=duplicationUi.locator('[data-pdf-feature="copy-page"] button');
  requireEvidence(await duplicateCommand.isEnabled(),'Duplicate page command was not available for ordinary two-page PDF');
  await duplicateCommand.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Duplicated page 1')),null,{timeout:30000});
  const duplicateExportWait=page.waitForEvent('download',{timeout:30000});
  await page.getByRole('button',{name:'Save PDF copy',exact:true}).click();
  const duplicateDownload=await duplicateExportWait;
  const duplicatePath=join(mkdtempSync(join(tmpdir(),'malenjo-duplicate-')),'duplicated.pdf');
  await duplicateDownload.saveAs(duplicatePath);
  const duplicateVerified=await PDFDocument.load(readFileSync(duplicatePath),{updateMetadata:false});
  const duplicateRefs=duplicateVerified.getPages().map(page=>page.ref.toString());
  requireEvidence(duplicateVerified.getPageCount()===3 &&
    duplicateVerified.getPages().map(page=>page.getWidth()).join(',')==='440,440,460' &&
    new Set(duplicateRefs).size===3 &&
    duplicateVerified.getTitle()==='Keep catalog metadata',
    'Duplicate page produced incorrect page order, reused page refs or lost metadata');
  await page.getByRole('button',{name:'Undo PDF edit',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-session-panel.active .pdf-notice')]
    .some(item=>item.textContent?.includes('Undid: Duplicated page 1')),null,{timeout:30000});
  const duplicateUndoWait=page.waitForEvent('download',{timeout:30000});
  await page.getByRole('button',{name:'Save PDF copy',exact:true}).click();
  const undoneDuplicate=await duplicateUndoWait;
  const undonePath=join(mkdtempSync(join(tmpdir(),'malenjo-duplicate-undo-')),'undone.pdf');
  await undoneDuplicate.saveAs(undonePath);
  requireEvidence((await PDFDocument.load(readFileSync(undonePath))).getPageCount()===2 &&
    (await PDFDocument.load(duplicateOriginalBytes)).getPageCount()===2,
    'Duplicate-page Undo did not restore two pages or changed the source document');
  console.log('PHASE2 duplicate-page UI, independent reference/metadata inspection and Undo: PASS');


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
