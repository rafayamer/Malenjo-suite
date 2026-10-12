import { describe, expect, it } from 'vitest';
import { applySuitePalette, MALENJO_BRAND_ACCENTS, MALENJO_THEME_PALETTES } from './themePalette';

function palette(mode: 'dark' | 'light'): Map<string, string> {
  return new Map(Object.entries(MALENJO_THEME_PALETTES[mode]));
}

function channel(hex: string): number[] {
  return [1, 3, 5].map((i) => {
    const value = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
}
function luminance(hex: string): number {
  const [r, g, b] = channel(hex);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

describe('MALENJO two-palette design contract', () => {
  const dark = palette('dark');
  const light = palette('light');
  it('supplies exactly matching semantic keys in Light and Dark', () => {
    expect(dark.size).toBeGreaterThanOrEqual(27);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });
  it('maintains readable ordinary and secondary text on core workspace surfaces', () => {
    for (const [name, theme] of [['Dark', dark], ['Light', light]] as const) {
      for (const surface of ['background', 'surface', 'card', 'toolbar', 'control', 'field', 'table-head']) {
        expect(contrast(theme.get('text')!, theme.get(surface)!),
          name + ' text/' + surface).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(theme.get('muted')!, theme.get('surface')!),
        name + ' secondary text').toBeGreaterThanOrEqual(4.5);
      for (const tone of ['error', 'warn', 'info', 'success']) {
        expect(contrast(theme.get(tone + '-fg')!, theme.get(tone + '-bg')!),
          name + ' ' + tone + ' feedback').toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('changes the neutral visual treatment without changing customer-visible brand hues', () => {
    expect(light.get('surface')).not.toBe(dark.get('surface'));
    expect(luminance(light.get('background')!)).toBeGreaterThan(luminance(dark.get('background')!));
    expect(MALENJO_BRAND_ACCENTS.blue).toBe('#2b8cff');
    expect(MALENJO_BRAND_ACCENTS.cyan).toBe('#33d4e5');
  });
  it('sets all 27 tokens and only MALENJO accent colors on a theme switch', () => {
    const applied = new Map<string, string>();
    const style = { setProperty: (key: string, value: string) => { applied.set(key, value); } };
    applySuitePalette(style as unknown as CSSStyleDeclaration, 'light');
    expect(applied.size).toBe(29);
    expect(applied.get('--ml-text')).toBe('#152c3f');
    expect(applied.get('--ml-brand-blue')).toBe('#2b8cff');
    applySuitePalette(style as unknown as CSSStyleDeclaration, 'dark');
    expect(applied.size).toBe(29);
    expect(applied.get('--ml-text')).toBe('#dce9f5');
    expect([...applied.keys()].every((key) => key.startsWith('--ml-'))).toBe(true);
  });
});
