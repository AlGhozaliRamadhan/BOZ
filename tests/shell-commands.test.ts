import { describe, expect, it } from 'vitest';
import {
  SHELL_COMMANDS,
  searchShellCommands,
} from '../src/app/components/layout/shell-commands.js';

describe('shell command search', () => {
  it('only lists real destinations that navigate somewhere on enter', () => {
    for (const command of SHELL_COMMANDS) {
      const navigates =
        (command.kind === 'route' && typeof command.href === 'string') ||
        (command.kind === 'action' &&
          (command.action === 'new-chat' ||
            command.action === 'open-settings' ||
            command.action === 'open-about'));
      expect(navigates, command.id).toBe(true);
    }
  });

  it('has no layout toggle entries', () => {
    const ids = SHELL_COMMANDS.map(command => command.id);
    expect(ids).not.toContain('toggle-sidebar');
    expect(ids).not.toContain('toggle-ticker');
    expect(ids).not.toContain('reset-layout');
  });

  it('finds settings sections by keyword', () => {
    expect(searchShellCommands('theme').map(command => command.id)).toContain('settings-appearance');
    expect(searchShellCommands('openai').map(command => command.id)).toContain('settings-providers');
    expect(searchShellCommands('ticker').map(command => command.id)).toContain('settings-layout');
    expect(searchShellCommands('avatar').map(command => command.id)).toContain('settings-profile');
  });

  it('opens settings entries on a valid settings tab', () => {
    for (const command of SHELL_COMMANDS.filter(entry => entry.action === 'open-settings')) {
      expect(['profile', 'providers', 'general']).toContain(command.settingsTab);
    }
  });

  it('returns every destination on an empty query', () => {
    expect(searchShellCommands('')).toHaveLength(SHELL_COMMANDS.length);
  });
});
