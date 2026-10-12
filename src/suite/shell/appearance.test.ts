import { describe, expect, it } from 'vitest';
import { APPEARANCE_STORAGE_KEY, nextSuiteTheme, readSuiteTheme, saveSuiteTheme } from './appearance';

describe('MALENJO same-window appearance', () => {
  it('defaults to the existing MALENJO dark theme and toggles in both directions', () => {
    expect(readSuiteTheme(null)).toBe('dark');
    expect(nextSuiteTheme('dark')).toBe('light');
    expect(nextSuiteTheme('light')).toBe('dark');
  });
  it('persists only the two accepted appearance values', () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(saveSuiteTheme(store, 'light')).toBe(true);
    expect(values.get(APPEARANCE_STORAGE_KEY)).toBe('light');
    expect(readSuiteTheme(store)).toBe('light');
    values.set(APPEARANCE_STORAGE_KEY, 'unexpected');
    expect(readSuiteTheme(store)).toBe('dark');
  });
  it('keeps the working UI usable when storage is disabled', () => {
    const denied = {
      getItem: (_key: string): string | null => { throw Error('blocked'); },
      setItem: (_key: string, _value: string): void => { throw Error('blocked'); },
    };
    expect(readSuiteTheme(denied)).toBe('dark');
    expect(saveSuiteTheme(denied, 'light')).toBe(false);
  });
});
