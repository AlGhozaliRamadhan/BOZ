export const SHELL_STORAGE_KEYS = {
  sidebarCollapsed: 'boz_shell_sidebar_collapsed',
  tickerVisible: 'boz_shell_ticker_visible',
  tickerPreferenceSet: 'boz_shell_ticker_preference_set',
  density: 'boz_shell_density',
  chatText: 'boz_shell_chat_text',
  font: 'boz_shell_font',
  motion: 'boz_shell_motion',
} as const;

/** Spacing scale of the shell: comfortable is default, compact scales UI down. */
export type UiDensity = 'comfortable' | 'compact';
/** Chat text size preset (zoom scale applied to the chat surface). */
export type ChatTextSize = 'small' | 'medium' | 'large';
/** UI font voice; all options carry the BOZ name (Settings → Appearance). */
export type BozFont = 'serif' | 'sans' | 'mono';
/**
 * Motion preference. 'system' follows the OS reduced-motion setting;
 * 'reduced' forces animations and transitions down regardless of the OS.
 */
export type MotionPreference = 'system' | 'reduced';

export interface ShellPreferences {
  sidebarCollapsed: boolean;
  tickerVisible: boolean;
  density: UiDensity;
  chatText: ChatTextSize;
  font: BozFont;
  motion: MotionPreference;
}

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  sidebarCollapsed: false,
  tickerVisible: false,
  density: 'comfortable',
  chatText: 'medium',
  font: 'serif',
  motion: 'system',
};

/** Zoom factors per preset; density shrinks the shell, chat text the surface. */
export const DENSITY_ZOOM: Record<UiDensity, string> = {
  comfortable: '1',
  compact: '0.94',
};

export const CHAT_TEXT_ZOOM: Record<ChatTextSize, string> = {
  small: '0.92',
  medium: '1',
  large: '1.08',
};

/** Font voices as indirections into the stacks defined in tokens.css. */
export const FONT_PRESETS: Record<BozFont, string> = {
  serif: 'var(--font-ui-serif)',
  sans: 'var(--font-ui-sans)',
  mono: 'var(--font-ui-mono)',
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

function parseStoredChoice<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function readShellPreferences(storage: ShellStorage): ShellPreferences {
  return {
    sidebarCollapsed: parseStoredBoolean(
      storage.getItem(SHELL_STORAGE_KEYS.sidebarCollapsed),
      DEFAULT_SHELL_PREFERENCES.sidebarCollapsed,
    ),
    tickerVisible: storage.getItem(SHELL_STORAGE_KEYS.tickerPreferenceSet) === 'true'
      ? parseStoredBoolean(storage.getItem(SHELL_STORAGE_KEYS.tickerVisible), DEFAULT_SHELL_PREFERENCES.tickerVisible)
      : DEFAULT_SHELL_PREFERENCES.tickerVisible,
    density: parseStoredChoice(
      storage.getItem(SHELL_STORAGE_KEYS.density),
      ['comfortable', 'compact'] as const,
      DEFAULT_SHELL_PREFERENCES.density,
    ),
    chatText: parseStoredChoice(
      storage.getItem(SHELL_STORAGE_KEYS.chatText),
      ['small', 'medium', 'large'] as const,
      DEFAULT_SHELL_PREFERENCES.chatText,
    ),
    font: parseStoredChoice(
      storage.getItem(SHELL_STORAGE_KEYS.font),
      ['serif', 'sans', 'mono'] as const,
      DEFAULT_SHELL_PREFERENCES.font,
    ),
    motion: parseStoredChoice(
      storage.getItem(SHELL_STORAGE_KEYS.motion),
      ['system', 'reduced'] as const,
      DEFAULT_SHELL_PREFERENCES.motion,
    ),
  };
}

export function writeShellPreferences(storage: ShellStorage, preferences: ShellPreferences): void {
  storage.setItem(SHELL_STORAGE_KEYS.sidebarCollapsed, String(preferences.sidebarCollapsed));
  storage.setItem(SHELL_STORAGE_KEYS.tickerVisible, String(preferences.tickerVisible));
  storage.setItem(SHELL_STORAGE_KEYS.tickerPreferenceSet, 'true');
  storage.setItem(SHELL_STORAGE_KEYS.density, preferences.density);
  storage.setItem(SHELL_STORAGE_KEYS.chatText, preferences.chatText);
  storage.setItem(SHELL_STORAGE_KEYS.font, preferences.font);
  storage.setItem(SHELL_STORAGE_KEYS.motion, preferences.motion);
}

/**
 * Applies the appearance variables to the document root, so plain stylesheets
 * and CSS modules pick them up without prop-drilling. Callers may pass any
 * object with a style and (optionally) a dataset of attribute-like state.
 */
export function applyShellAppearance(
  target: {
    style: { setProperty(name: string, value: string): void };
    dataset?: Record<string, string | undefined>;
  },
  preferences: Pick<ShellPreferences, 'density' | 'chatText' | 'font' | 'motion'>,
): void {
  target.style.setProperty('--ui-density-zoom', DENSITY_ZOOM[preferences.density]);
  target.style.setProperty('--chat-text-zoom', CHAT_TEXT_ZOOM[preferences.chatText]);
  target.style.setProperty('--font-ui', FONT_PRESETS[preferences.font]);
  // Reduced motion is expressed as an attribute, read by animations.css. In
  // the default 'system' mode the attribute stays off so the OS media query
  // alone governs the level.
  if (target.dataset) {
    if (preferences.motion === 'reduced') target.dataset.motion = 'reduced';
    else delete target.dataset.motion;
  }
}
