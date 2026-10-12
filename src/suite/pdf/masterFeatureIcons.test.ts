import {describe,expect,it} from 'vitest';
import {PDF_COMMANDS,PDF_COMMAND_BY_ID} from '../commands/masterCatalog';
import {MASTER_FEATURE_ICON_BY_ID} from './masterFeatureIcons';
import {PDF_SHORTCUT_MASTER_IDS} from './PdfFeatureIcon';
import {USER_PDF_TOOLS,USER_PDF_TOOL_GROUPS} from './userPdfTools';

describe('Phase 1 owner acceptance: unique tool identity and sensible grouping',()=>{
  it('keeps 90 uniquely keyed, visually distinct symbols for all 90 PDF requirements',()=>{
    expect(PDF_COMMANDS).toHaveLength(90);
    expect(new Set(PDF_COMMANDS.map(command=>command.icon)).size).toBe(90);
    expect(Object.keys(MASTER_FEATURE_ICON_BY_ID)).toHaveLength(90);
    expect(new Set(Object.values(MASTER_FEATURE_ICON_BY_ID)).size).toBe(90);
    for(const command of PDF_COMMANDS)expect(MASTER_FEATURE_ICON_BY_ID[command.id]).toBeDefined();
  });
  it('maps all 33 shortcuts one-to-one onto canonical commands, in seven actual groups',()=>{
    expect(USER_PDF_TOOLS).toHaveLength(33);
    expect(USER_PDF_TOOL_GROUPS).toHaveLength(7);
    expect(Object.keys(PDF_SHORTCUT_MASTER_IDS)).toHaveLength(33);
    expect(new Set(Object.values(PDF_SHORTCUT_MASTER_IDS)).size).toBe(33);
    expect(new Set(USER_PDF_TOOLS.map(item=>item.id)).size).toBe(33);
    expect(new Set(USER_PDF_TOOLS.map(item=>item.label)).size).toBe(33);
    for(const tool of USER_PDF_TOOLS){
      expect(USER_PDF_TOOL_GROUPS).toContain(tool.group);
      expect(PDF_COMMAND_BY_ID.has(PDF_SHORTCUT_MASTER_IDS[tool.id])).toBe(true);
      expect(MASTER_FEATURE_ICON_BY_ID[PDF_SHORTCUT_MASTER_IDS[tool.id]]).toBeDefined();
    }
  });
});
