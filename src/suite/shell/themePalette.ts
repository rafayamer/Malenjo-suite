import type { SuiteTheme } from './appearance';

/** Exactly two MALENJO palettes. Brand accent colors never change between them. */
export const MALENJO_THEME_PALETTES = {
  dark: {
    background:'#07131f',surface:'#081723',field:'#071722',control:'#0d2235',toolbar:'#091824',
    'pane-bg':'#0d1720',surround:'#101a23',card:'#091a27','tab-bg':'#091722','tab-active':'#0d2233',
    selected:'#0c2233',hover:'#0c2232','hover-strong':'#12304a',subtle:'#0a1d2b',
    'table-head':'#0b1d2c','grid-bg':'#0b1721','info-bg':'#092830','error-bg':'#2b1619',
    'warn-bg':'#2c2415','success-bg':'#0d2d25',text:'#dce9f5',muted:'#7895a9',
    border:'#1e3850','error-fg':'#efb6b6','warn-fg':'#d5bd78','info-fg':'#99e5ed','success-fg':'#67ddb2',
  },
  light: {
    background:'#f1f5f8',surface:'#ffffff',field:'#ffffff',control:'#e9f1f8',toolbar:'#f8fbfd',
    'pane-bg':'#e9eff5',surround:'#d8e0e7',card:'#ffffff','tab-bg':'#e7eef4','tab-active':'#ffffff',
    selected:'#daeafa',hover:'#e6f1fa','hover-strong':'#cfe4f6',subtle:'#eaf1f6',
    'table-head':'#e5edf4','grid-bg':'#ffffff','info-bg':'#e8f6f9','error-bg':'#fff0f0',
    'warn-bg':'#fff4d8','success-bg':'#e1f7ed',text:'#152c3f',muted:'#49677a',
    border:'#becfdb','error-fg':'#962831','warn-fg':'#795400','info-fg':'#185d68','success-fg':'#126044',
  },
} as const satisfies Record<SuiteTheme, Record<string,string>>;

export const MALENJO_BRAND_ACCENTS = {
  blue:'#2b8cff',
  cyan:'#33d4e5',
} as const;

export function applySuitePalette(style: Pick<CSSStyleDeclaration, 'setProperty'>, theme: SuiteTheme): void {
  const palette: Record<string,string> = MALENJO_THEME_PALETTES[theme];
  for (const [key,value] of Object.entries(palette)) style.setProperty('--ml-' + key,value);
  style.setProperty('--ml-brand-blue',MALENJO_BRAND_ACCENTS.blue);
  style.setProperty('--ml-brand-cyan',MALENJO_BRAND_ACCENTS.cyan);
}
