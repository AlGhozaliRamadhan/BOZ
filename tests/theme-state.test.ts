import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, readTheme, writeTheme, THEME_STORAGE_KEY } from '@/app/components/layout/theme-state';
import { fakeStorage } from './helpers';

describe('theme-state', () => {
  it('defaults to dark when nothing is stored', () => {
    const storage = fakeStorage();
    expect(readTheme(storage)).toBe(DEFAULT_THEME);
    expect(readTheme(storage)).toBe('dark');
  });

  it('reads a stored light theme', () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'light' });
    expect(readTheme(storage)).toBe('light');
  });

  it('falls back to dark for unknown values', () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'solarized' });
    expect(readTheme(storage)).toBe('dark');
  });

  it('writes the theme back to storage', () => {
    const storage = fakeStorage();
    writeTheme(storage, 'light');
    expect(storage.store[THEME_STORAGE_KEY]).toBe('light');
    expect(readTheme(storage)).toBe('light');
  });
});
