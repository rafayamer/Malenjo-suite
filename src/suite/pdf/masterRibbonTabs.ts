import type { PdfTaskCategory } from './taskToolbar';

/** MALENJO Master Development Specification v2.0: ten *visible* PDF tabs.
 * Existing PDF operation handlers keep their internal legacy category keys.
 * Mapping avoids reimplementing any verified PDF mutation or provider logic. */
export const PDF_MASTER_TABS = [
  {id:'home',label:'Home',category:'home',shortcut:'Alt+Shift+1'},
  {id:'edit',label:'Edit',category:'edit',shortcut:'Alt+Shift+2'},
  {id:'organize',label:'Organize',category:'organize',shortcut:'Alt+Shift+3'},
  {id:'optimize',label:'Optimize',category:'scan',shortcut:'Alt+Shift+4'},
  {id:'convert',label:'Convert',category:'convert',shortcut:'Alt+Shift+5'},
  {id:'forms',label:'Forms',category:'forms',shortcut:'Alt+Shift+6'},
  {id:'review',label:'Review',category:'comment',shortcut:'Alt+Shift+7'},
  {id:'protect',label:'Protect',category:'protect',shortcut:'Alt+Shift+8'},
  {id:'automate',label:'Automate',category:'automate',shortcut:'Alt+Shift+9'},
  {id:'tools',label:'Tools',category:'ai',shortcut:'Alt+Shift+0'},
] as const satisfies ReadonlyArray<{
  id:string;label:string;category:PdfTaskCategory;shortcut:string;
}>;

export type PdfMasterTab = typeof PDF_MASTER_TABS[number]['id'];

export function masterTabForCategory(category:PdfTaskCategory):PdfMasterTab {
  if(category==='sign')return 'protect';
  return PDF_MASTER_TABS.find(tab=>tab.category===category)?.id ?? 'home';
}

export function moveMasterPdfTab(
  current:PdfMasterTab, key:'ArrowLeft'|'ArrowRight'|'Home'|'End',
):PdfMasterTab {
  if(key==='Home')return PDF_MASTER_TABS[0].id;
  if(key==='End')return PDF_MASTER_TABS[PDF_MASTER_TABS.length-1].id;
  const index=PDF_MASTER_TABS.findIndex(tab=>tab.id===current);
  const step=key==='ArrowRight'?1:-1;
  return PDF_MASTER_TABS[(index+step+PDF_MASTER_TABS.length)%PDF_MASTER_TABS.length].id;
}

export function masterPdfTabFromShortcut(event:{
  altKey:boolean;shiftKey:boolean;ctrlKey:boolean;metaKey:boolean;code:string;
}):PdfMasterTab|null {
  if(!event.altKey||!event.shiftKey||event.ctrlKey||event.metaKey)return null;
  const digit=/^Digit([0-9])$/.exec(event.code)?.[1];
  if(digit===undefined)return null;
  return PDF_MASTER_TABS[digit==='0'?9:Number(digit)-1]?.id ?? null;
}
