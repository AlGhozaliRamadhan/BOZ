import { DEFAULT_THEME, readTheme, type Theme } from '@/app/components/layout/theme-state';
import { readShellPreferences, type ShellPreferences } from '@/app/components/layout/shell-state';

export interface FakeStorage {
  store: Record<string, string>;
}

export function fakeStorage(initial: Record<string, string> = {}): FakeStorage & {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const store = { ...initial };
  return {
    store,
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
}

export function fakeTheme(): Theme {
  return DEFAULT_THEME;
}

export function readFakeTheme(storage: { getItem(key: string): string | null }): Theme {
  return readTheme(storage);
}

export function readFakeShellPreferences(storage: {
  getItem(key: string): string | null;
}): ShellPreferences {
  return readShellPreferences(storage);
}
