import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELL_PREFERENCES,
  applyShellAppearance,
  readShellPreferences,
  writeShellPreferences,
  parseStoredBoolean,
  type ShellPreferences,
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

  it('round-trips explicitly saved shell preferences including the visual scales', () => {
    const storage = createStorage();
    const preferences: ShellPreferences = {
      sidebarCollapsed: true,
      tickerVisible: false,
      density: 'compact',
      chatText: 'large',
      font: 'mono',
      motion: 'reduced',
    };

    writeShellPreferences(storage, preferences);

    expect(readShellPreferences(storage)).toEqual(preferences);
  });

  it('falls back to the default presets for unknown stored values', () => {
    const storage = createStorage({
      boz_shell_density: 'roomy',
      boz_shell_chat_text: 'huge',
      boz_shell_font: 'comic',
      boz_shell_motion: 'cinematic',
    });

    const preferences = readShellPreferences(storage);

    expect(preferences.density).toBe('comfortable');
    expect(preferences.chatText).toBe('medium');
    expect(preferences.font).toBe('serif');
    expect(preferences.motion).toBe('system');
  });

  it('applies zooms, the font voice, and forces the motion attribute when reduced', () => {
    const applied: Record<string, string> = {};
    const dataset: Record<string, string | undefined> = {};
    applyShellAppearance(
      {
        style: { setProperty: (name, value) => { applied[name] = value; } },
        dataset,
      },
      { density: 'compact', chatText: 'large', font: 'sans', motion: 'reduced' },
    );

    expect(applied['--ui-density-zoom']).toBe('0.94');
    expect(applied['--chat-text-zoom']).toBe('1.08');
    expect(applied['--font-ui']).toBe('var(--font-ui-sans)');
    expect(dataset.motion).toBe('reduced');
  });

  it('clears the motion attribute in system mode so the OS setting decides', () => {
    const applied: Record<string, string> = {};
    const dataset: Record<string, string | undefined> = { motion: 'reduced' };
    applyShellAppearance(
      {
        style: { setProperty: (name, value) => { applied[name] = value; } },
        dataset,
      },
      { density: 'comfortable', chatText: 'medium', font: 'mono', motion: 'system' },
    );

    expect(applied['--font-ui']).toBe('var(--font-ui-mono)');
    expect(dataset.motion).toBeUndefined();
  });

  it('routes the global navigation commands to existing BOZ pages', () => {
    expect(getShellNavigationTarget('newChat')).toBe('/chat');
    expect(getShellNavigationTarget('dashboard')).toBe('/');
    expect(getShellRouteLabel('/chat/example')).toBe('Chat Agent');
    expect(getShellRouteLabel('/discover')).toBe('Discover');
    expect(getShellRouteLabel('/ticker/BTC-USD')).toBe('Market Dashboard');
    expect(getShellRouteLabel('/dashboard/BTC-USD')).toBe('Market Dashboard');
    expect(getShellRouteLabel('/')).toBe('Dashboard');
  });
});
