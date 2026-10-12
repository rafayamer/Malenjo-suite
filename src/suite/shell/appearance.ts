export type SuiteTheme = 'dark' | 'light';

export const APPEARANCE_STORAGE_KEY = 'malenjo:suite-theme:v1';

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readSuiteTheme(storage?: ThemeStorage | null): SuiteTheme {
  try {
    const value = storage?.getItem(APPEARANCE_STORAGE_KEY);
    return value === 'light' ? 'light' : 'dark';
  } catch {
    // Sandboxed/private browser contexts can reject storage access.
    return 'dark';
  }
}

export function saveSuiteTheme(storage: ThemeStorage | null | undefined, theme: SuiteTheme): boolean {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, theme);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function nextSuiteTheme(theme: SuiteTheme): SuiteTheme {
  return theme === 'dark' ? 'light' : 'dark';
}
