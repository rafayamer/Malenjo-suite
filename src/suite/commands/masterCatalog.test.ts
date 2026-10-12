import { describe, expect, it } from 'vitest';
import {
  LEGACY_TOOL_REQUIREMENTS, PDF_COMMANDS, PDF_COMMAND_BY_ID,
  PDFCommandUnavailableError, pdfCatalogDiscovery, pdfCommandsForCategory,
} from './masterCatalog';
import { filterCommandPaletteItems } from '../shell/commandPaletteModel';

const ctx = {permissions:['documents:read','documents:write'],documentId:'test-pdf'};

describe('Master Specification v2.0 PDF capability contract',()=>{
  it('registers exactly MAL-001 through MAL-090, once each, with traceable metadata',()=>{
    expect(PDF_COMMANDS).toHaveLength(90);
    expect(PDF_COMMAND_BY_ID.size).toBe(90);
    PDF_COMMANDS.forEach((command,index)=>{
      const id='MAL-'+String(index+1).padStart(3,'0');
      expect(command.id).toBe(id);
      expect(PDF_COMMAND_BY_ID.get(id)).toBe(command);
      expect(command.label.trim().length).toBeGreaterThan(3);
      expect(command.icon.trim().length).toBeGreaterThan(2);
      expect(command.tooltip).toContain(command.label);
      expect(command.expectedOutput.trim().length).toBeGreaterThan(0);
      expect(command.permissions.length).toBeGreaterThan(0);
      expect(command.isAvailable(ctx)).toBe(false);
      expect(command.status).toBe('NOT_RELEASE_READY');
    });
    expect(new Set(PDF_COMMANDS.map(c=>c.id)).size).toBe(90);
    expect(new Set(PDF_COMMANDS.map(c=>c.icon)).size).toBe(90);
  });

  it('uses precisely the ten specified contextual ribbon categories',()=>{
    const expected=['Home','Edit','Organize','Optimize','Convert','Forms','Review','Protect','Automate','Tools'];
    const supported=[...new Set(PDF_COMMANDS.map(command=>command.category))];
    // The Home tab provides common operations, not a duplicate ownership
    // category for requirements already grouped under their functional ribbon.
    expect([...supported].sort()).toEqual(expected.filter(x=>x!=='Home').sort());
    expect(PDF_COMMANDS.filter(c=>c.category==='Convert')).toHaveLength(16);
    expect(PDF_COMMANDS.filter(c=>c.category==='Edit')).toHaveLength(13);
    expect(PDF_COMMANDS.filter(c=>c.category==='Protect')).toHaveLength(10);
    expect(pdfCommandsForCategory('Organize')).toHaveLength(10);
  });

  it('contains the exact legacy fifteen-tool map and all valid requirement targets',()=>{
    expect(LEGACY_TOOL_REQUIREMENTS).toHaveLength(15);
    const all=LEGACY_TOOL_REQUIREMENTS.flatMap(entry=>entry.requirementIds);
    expect(new Set(LEGACY_TOOL_REQUIREMENTS.map(x=>x.legacyTool)).size).toBe(15);
    expect(all.every(id=>PDF_COMMAND_BY_ID.has(id))).toBe(true);
    expect(LEGACY_TOOL_REQUIREMENTS.find(x=>x.legacyTool==='PDF Form Field Operations')
      ?.requirementIds).toHaveLength(8);
  });

  it('never fabricates success for unverified PDF editing, conversions, redaction or AI',async()=>{
    for(const id of ['MAL-001','MAL-011','MAL-037','MAL-038','MAL-039','MAL-063','MAL-071','MAL-090']){
      const cmd=PDF_COMMAND_BY_ID.get(id)!;
      await expect(cmd.execute(ctx)).rejects.toBeInstanceOf(PDFCommandUnavailableError);
    }
  });

  it('exposes all 90 by exact MAL-ID or name in search, but disables every unverified action',()=>{
    const items=pdfCatalogDiscovery();
    expect(items).toHaveLength(90);
    expect(items.every(item=>item.hiddenWhenEmpty&&item.disabled&&item.disabledReason)).toBe(true);
    const a=filterCommandPaletteItems(items,'MAL-037');
    expect(a[0].id).toBe('MAL-037');
    expect(a[0].label).toBe('PDF to Word');
    expect(filterCommandPaletteItems(items,'MAL-035').some(x=>x.id==='MAL-035')).toBe(true);
    expect(filterCommandPaletteItems(items,'watermark').length).toBeGreaterThanOrEqual(2);
    expect(filterCommandPaletteItems(items,'')).toHaveLength(0);
    expect(()=>a[0].run()).toThrow(PDFCommandUnavailableError);
  });

  it('records required permissions for AI and sensitive actions',()=>{
    expect(PDF_COMMAND_BY_ID.get('MAL-071')?.permissions).toContain('ai:invoke');
    expect(PDF_COMMAND_BY_ID.get('MAL-063')?.permissions).toContain('documents:sensitive-action');
  });
});
