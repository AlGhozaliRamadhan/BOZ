export const SHELL_STORAGE_KEYS = {
  sidebarCollapsed: 'boz_shell_sidebar_collapsed',
  tickerVisible: 'boz_shell_ticker_visible',
} as const;

export interface ShellPreferences {
  sidebarCollapsed: boolean;
  tickerVisible: boolean;
}

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  sidebarCollapsed: false,
  tickerVisible: true,
};

export interface ShellStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseStoredBoolean(value: string | null, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function readShellPreferences(storage: ShellStorage): ShellPreferences {
  return {
    sidebarCollapsed: parseStoredBoolean(
      storage.getItem(SHELL_STORAGE_KEYS.sidebarCollapsed),
      DEFAULT_SHELL_PREFERENCES.sidebarCollapsed,
    ),
    tickerVisible: parseStoredBoolean(
      storage.getItem(SHELL_STORAGE_KEYS.tickerVisible),
      DEFAULT_SHELL_PREFERENCES.tickerVisible,
    ),
  };
}

export function writeShellPreferences(storage: ShellStorage, preferences: ShellPreferences): void {
  storage.setItem(SHELL_STORAGE_KEYS.sidebarCollapsed, String(preferences.sidebarCollapsed));
  storage.setItem(SHELL_STORAGE_KEYS.tickerVisible, String(preferences.tickerVisible));
}
