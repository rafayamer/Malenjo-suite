import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

function palette(mode: 'dark' | 'light'): Map<string, string> {
  const selector = mode === 'dark' ? ':root' : ':root\\[data-theme="light"\\]';
  const match = css.match(new RegExp('/\\* Semantic MALENJO surfaces[\\s\\S]*?\\*/\\s*:root\\s*\\{([\\s\\S]*?)\\}\\s*:root\\[data-theme="light"\\]\\s*\\{([\\s\\S]*?)\\}'));
  if (!match) throw new Error('Semantic MALENJO dark/light palettes are missing.');
  const lines = mode === 'dark' ? match[1] : match[2];
  return new Map([...lines.matchAll(/--ml-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((row) => [row[1], row[2]]));
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
    expect(css).toContain('--ml-brand-blue:#2b8cff');
    expect(css).toContain('--ml-brand-cyan:#33d4e5');
  });
  it('preserves a visibly rendered paper/canvas instead of recoloring document pixels', () => {
    expect(css).toContain('.pdf-page-shell{');
    expect(css).toContain('background:white');
    expect(css).toContain('.pdf-page-shell canvas{display:block;background:white}');
  });
});
