import type { PDFRibbonCategory } from '../commands/masterCatalog';
/** Canonical ten PDF ribbon tabs from MALENJO Master Specification v2.0. */
export const PDF_TASK_CATEGORIES = [
  'home','edit','organize','optimize','convert',
  'forms','review','protect','automate','tools',
] as const;
export type PdfTaskCategory=typeof PDF_TASK_CATEGORIES[number];

export const PDF_TASK_CATEGORY_LABELS:Record<PdfTaskCategory,PDFRibbonCategory>={
  home:'Home', edit:'Edit', organize:'Organize', optimize:'Optimize',
  convert:'Convert', forms:'Forms', review:'Review', protect:'Protect',
  automate:'Automate',tools:'Tools',
};
export const PDF_TASK_CATEGORY_SHORTCUTS:Record<PdfTaskCategory,string>={
  home:'Alt+Shift+1',edit:'Alt+Shift+2',organize:'Alt+Shift+3',
  optimize:'Alt+Shift+4',convert:'Alt+Shift+5',
  forms:'Alt+Shift+6',review:'Alt+Shift+7',protect:'Alt+Shift+8',
  automate:'Alt+Shift+9',tools:'Alt+Shift+0',
};
const shortcutCode:Record<string,PdfTaskCategory>={
  Digit1:'home',Digit2:'edit',Digit3:'organize',Digit4:'optimize',
  Digit5:'convert',Digit6:'forms',Digit7:'review',Digit8:'protect',
  Digit9:'automate',Digit0:'tools',
};
export interface PdfTaskShortcutEventLike {
  altKey:boolean;shiftKey:boolean;ctrlKey:boolean;metaKey:boolean;code:string
}
export function pdfTaskCategoryFromShortcut(event:PdfTaskShortcutEventLike):PdfTaskCategory|null{
  if(!event.altKey||!event.shiftKey||event.ctrlKey||event.metaKey)return null;
  return shortcutCode[event.code]??null;
}
export function movePdfTaskCategory(
  current:PdfTaskCategory,key:'ArrowLeft'|'ArrowRight'|'Home'|'End',
):PdfTaskCategory{
  if(key==='Home')return PDF_TASK_CATEGORIES[0];
  if(key==='End')return PDF_TASK_CATEGORIES[PDF_TASK_CATEGORIES.length-1];
  const index=PDF_TASK_CATEGORIES.indexOf(current);
  const delta=key==='ArrowRight'?1:-1;
  return PDF_TASK_CATEGORIES[(index+delta+PDF_TASK_CATEGORIES.length)%PDF_TASK_CATEGORIES.length];
}
