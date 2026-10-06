import { describe, expect, it } from 'vitest';
import { PDF_TASK_CATEGORIES, PDF_TASK_CATEGORY_LABELS, PDF_TASK_CATEGORY_SHORTCUTS, movePdfTaskCategory, pdfTaskCategoryFromShortcut } from './taskToolbar';

describe('PDF task toolbar contract',()=>{
  it('keeps the canonical 53.9 category order',()=>{
    expect(PDF_TASK_CATEGORIES).toEqual(['home','edit','convert','organize','comment','sign','protect','forms','ai','scan','automate']);
    expect(new Set(PDF_TASK_CATEGORIES).size).toBe(PDF_TASK_CATEGORIES.length);
    expect(PDF_TASK_CATEGORIES.map((id)=>PDF_TASK_CATEGORY_LABELS[id])).toEqual(['Home','Edit','Convert','Organize','Comment','Sign','Protect','Forms','AI','Scan','Automate']);
  });
  it('provides an explicit shortcut for every category',()=>{
    expect(PDF_TASK_CATEGORIES.every((id)=>!!PDF_TASK_CATEGORY_SHORTCUTS[id])).toBe(true);
    expect(new Set(PDF_TASK_CATEGORIES.map((id)=>PDF_TASK_CATEGORY_SHORTCUTS[id])).size).toBe(PDF_TASK_CATEGORIES.length);
  });
  it('resolves only Alt+Shift task shortcuts',()=>{
    expect(pdfTaskCategoryFromShortcut({altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit4'})).toBe('organize');
    expect(pdfTaskCategoryFromShortcut({altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,code:'Minus'})).toBe('automate');
    expect(pdfTaskCategoryFromShortcut({altKey:false,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit4'})).toBeNull();
    expect(pdfTaskCategoryFromShortcut({altKey:true,shiftKey:true,ctrlKey:true,metaKey:false,code:'Digit4'})).toBeNull();
  });
  it('supports roving keyboard navigation with wraparound',()=>{
    expect(movePdfTaskCategory('home','ArrowLeft')).toBe('automate');
    expect(movePdfTaskCategory('automate','ArrowRight')).toBe('home');
    expect(movePdfTaskCategory('forms','Home')).toBe('home');
    expect(movePdfTaskCategory('forms','End')).toBe('automate');
  });
});
