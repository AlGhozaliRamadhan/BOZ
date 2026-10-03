export const THEME_STORAGE_KEY = 'boz_theme';

export type Theme = 'dark' | 'light';

export const DEFAULT_THEME: Theme = 'dark';

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readTheme(storage: ThemeStorage): Theme {
  try {
    return storage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(storage: ThemeStorage, theme: Theme): void {
  storage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
