import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELL_PREFERENCES,
  readShellPreferences,
  writeShellPreferences,
  parseStoredBoolean,
  type ShellStorage,
} from '../src/app/components/layout/shell-state.js';
import { getShellNavigationTarget, getShellRouteLabel } from '../src/app/components/layout/shell-menu.js';

function createStorage(initial: Record<string, string> = {}): ShellStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: key => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
  };
}

describe('shell layout preferences', () => {
  it('uses the expanded sidebar and hidden ticker by default', () => {
    expect(readShellPreferences(createStorage())).toEqual(DEFAULT_SHELL_PREFERENCES);
  });

  it('ignores malformed stored booleans instead of changing the default layout', () => {
    expect(parseStoredBoolean('yes', false)).toBe(false);
    expect(parseStoredBoolean('1', true)).toBe(true);
    expect(parseStoredBoolean(null, true)).toBe(true);
  });

  it('uses the new hidden ticker default instead of a pre-preference legacy value', () => {
    const storage = createStorage({ boz_shell_ticker_visible: 'true' });

    expect(readShellPreferences(storage)).toEqual(DEFAULT_SHELL_PREFERENCES);
  });

  it('round-trips explicitly saved sidebar and ticker preferences', () => {
    const storage = createStorage();
    const preferences = { sidebarCollapsed: true, tickerVisible: false };

    writeShellPreferences(storage, preferences);

    expect(readShellPreferences(storage)).toEqual(preferences);
  });

  it('routes the global navigation commands to existing BOZ pages', () => {
    expect(getShellNavigationTarget('newChat')).toBe('/chat');
    expect(getShellNavigationTarget('dashboard')).toBe('/');
    expect(getShellRouteLabel('/chat/example')).toBe('Chat Agent');
    expect(getShellRouteLabel('/ticker/BTC-USD')).toBe('Market Dashboard');
    expect(getShellRouteLabel('/dashboard/BTC-USD')).toBe('Market Dashboard');
    expect(getShellRouteLabel('/')).toBe('Dashboard');
  });
});
