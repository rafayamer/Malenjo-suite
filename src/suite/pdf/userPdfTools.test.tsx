import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PdfFeatureIcon } from './PdfFeatureIcon';
import { USER_PDF_TOOLS, USER_PDF_TOOL_GROUPS, userPdfToolsByGroup } from './userPdfTools';

describe('MALENJO 33 requested PDF manipulation tools',()=>{
  it('lists all 33 tools in exactly seven coherent, discoverable categories',()=>{
    expect(USER_PDF_TOOLS).toHaveLength(33);
    expect(USER_PDF_TOOL_GROUPS).toEqual([
      'Organize PDF','Optimize PDF','Convert to PDF','Convert from PDF',
      'Edit PDF','PDF Security','PDF Intelligence',
    ]);
    expect(new Set(USER_PDF_TOOLS.map(tool=>tool.id)).size).toBe(33);
    const expectedCounts=[6,3,5,5,6,5,3];
    USER_PDF_TOOL_GROUPS.forEach((group,index)=>{
      expect(userPdfToolsByGroup(group)).toHaveLength(expectedCounts[index]);
    });
  });

  it('has the 33 exact end-user operations, not invented Office apps',()=>{
    const labels=[
      'Merge PDF','Split PDF','Remove pages','Extract pages','Organize PDF','Scan to PDF',
      'Compress PDF','Repair PDF','OCR PDF',
      'JPG to PDF','Word to PDF','PowerPoint to PDF','Excel to PDF','HTML to PDF',
      'PDF to JPG','PDF to Word','PDF to PowerPoint','PDF to Excel','PDF to PDF/A',
      'Rotate PDF','Page numbers','Watermark','Crop PDF','Edit PDF','PDF Forms',
      'Unlock PDF','Protect PDF','Sign PDF','Redact PDF','Compare PDF',
      'AI Summarizer','Translate PDF','PDF to Markdown',
    ];
    expect(USER_PDF_TOOLS.map(tool=>tool.label)).toEqual(labels);
    for(const tool of USER_PDF_TOOLS){
      expect(tool.explanation.trim().length).toBeGreaterThan(30);
      expect(renderToStaticMarkup(
        <PdfFeatureIcon id={tool.id} label={tool.label} />
      )).toContain('<svg');
    }
  });

  it('links only implemented, locally routed operations; does not fake Office conversion',()=>{
    const liveActionIds=USER_PDF_TOOLS.filter(tool=>tool.actionId).map(tool=>tool.id);
    expect(liveActionIds).toContain('merge-pdf');
    expect(liveActionIds).toContain('pdf-to-jpg');
    expect(liveActionIds).toContain('jpg-to-pdf');
    for(const id of ['pdf-to-word','pdf-to-excel','pdf-to-powerpoint',
      'word-to-pdf','excel-to-pdf','powerpoint-to-pdf','translate-pdf','compress-pdf']){
      const tool=USER_PDF_TOOLS.find(item=>item.id===id)!;
      expect(tool.actionId).toBeUndefined();
      expect(tool.destination).toBeUndefined();
    }
  });
});
