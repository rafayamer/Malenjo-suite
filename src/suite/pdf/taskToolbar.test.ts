import { describe, expect, it } from 'vitest';
import { PDF_TASK_CATEGORIES, PDF_TASK_CATEGORY_LABELS, PDF_TASK_CATEGORY_SHORTCUTS, movePdfTaskCategory, pdfTaskCategoryFromShortcut } from './taskToolbar';

const categories=['home','edit','organize','optimize','convert','forms','review','protect','automate','tools'];

describe('PDF-only Master v2 ten-category ribbon',()=>{
  it('matches the canonical desktop tabs without a duplicate AI/Sign/Scan tab',()=>{
    expect(PDF_TASK_CATEGORIES).toEqual(categories);
    expect(PDF_TASK_CATEGORIES.map(key=>PDF_TASK_CATEGORY_LABELS[key]))
      .toEqual(['Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools']);
    expect(new Set(PDF_TASK_CATEGORIES).size).toBe(10);
  });
  it('assigns distinct safe keyboard shortcuts to all ten categories',()=>{
    expect(new Set(PDF_TASK_CATEGORIES.map(key=>PDF_TASK_CATEGORY_SHORTCUTS[key])).size).toBe(10);
    expect(pdfTaskCategoryFromShortcut({altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit4'}))
      .toBe('optimize');
    expect(pdfTaskCategoryFromShortcut({altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit0'}))
      .toBe('tools');
    expect(pdfTaskCategoryFromShortcut({altKey:false,shiftKey:true,ctrlKey:false,metaKey:false,code:'Digit4'}))
      .toBeNull();
  });
  it('wraps through all ten categories and respects Home and End',()=>{
    expect(movePdfTaskCategory('home','ArrowLeft')).toBe('tools');
    expect(movePdfTaskCategory('tools','ArrowRight')).toBe('home');
    expect(movePdfTaskCategory('forms','Home')).toBe('home');
    expect(movePdfTaskCategory('forms','End')).toBe('tools');
  });
});
