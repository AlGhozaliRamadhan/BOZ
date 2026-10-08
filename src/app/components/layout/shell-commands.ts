export type ShellCommandKind = 'route' | 'action';

export type ShellCommandAction = 'new-chat' | 'open-settings' | 'open-about';

export type SettingsTab = 'profile' | 'providers' | 'general';

export interface ShellCommand {
  id: string;
  label: string;
  hint: string;
  icon: string;
  kind: ShellCommandKind;
  keywords: string[];
  href?: string;
  action?: ShellCommandAction;
  settingsTab?: SettingsTab;
}

// Only real destinations: every entry navigates somewhere (a page, a new
// chat, a settings section, or the about dialog) when committed with Enter.
// Layout toggles are intentionally absent — they live in Settings → General.
export const SHELL_COMMANDS: ShellCommand[] = [
  {
    id: 'go-dashboard',
    label: 'Dashboard',
    hint: '/',
    icon: 'fa-regular fa-compass',
    kind: 'route',
    keywords: ['home', 'overview', 'intelligence', 'watchlist'],
    href: '/',
  },
  {
    id: 'go-chat',
    label: 'Chat Agent',
    hint: '/chat',
    icon: 'fa-regular fa-comment-dots',
    kind: 'route',
    keywords: ['ai', 'assistant', 'conversation', 'agent'],
    href: '/chat',
  },
  {
    id: 'go-discover',
    label: 'Discover',
    hint: '/discover',
    icon: 'fa-regular fa-compass',
    kind: 'route',
    keywords: ['discover', 'explore', 'ticker', 'search', 'trending', 'ideas', 'watchlist'],
    href: '/discover',
  },
  {
    id: 'go-screener',
    label: 'Screeners',
    hint: '/screener',
    icon: 'fa-regular fa-chart-bar',
    kind: 'route',
    keywords: ['scan', 'scanner', 'filter', 'stocks', 'idx'],
    href: '/screener',
  },
  {
    id: 'go-intraday',
    label: 'Intraday Analysis',
    hint: '/analyze/intraday',
    icon: 'fa-solid fa-bolt',
    kind: 'route',
    keywords: ['day trading', 'daytrade', 'short term', 'intraday'],
    href: '/analyze/intraday',
  },
  {
    id: 'go-longterm',
    label: 'Long-term Analysis',
    hint: '/analyze/longterm',
    icon: 'fa-solid fa-chart-line',
    kind: 'route',
    keywords: ['investing', 'longterm', 'swing', 'long term'],
    href: '/analyze/longterm',
  },
  {
    id: 'go-news',
    label: 'News Intel',
    hint: '/news-intel',
    icon: 'fa-regular fa-newspaper',
    kind: 'route',
    keywords: ['news', 'sentiment', 'headlines', 'intel'],
    href: '/news-intel',
  },
  {
    id: 'new-chat',
    label: 'New Chat',
    hint: 'Ctrl+N',
    icon: 'fa-regular fa-pen-to-square',
    kind: 'action',
    keywords: ['compose', 'fresh', 'start', 'conversation'],
    action: 'new-chat',
  },
  {
    id: 'settings-profile',
    label: 'Profile settings',
    hint: 'Settings',
    icon: 'fa-solid fa-user',
    kind: 'action',
    keywords: ['profile', 'display name', 'avatar', 'trading style', 'account'],
    action: 'open-settings',
    settingsTab: 'profile',
  },
  {
    id: 'settings-providers',
    label: 'AI Providers',
    hint: 'Settings',
    icon: 'fa-solid fa-plug',
    kind: 'action',
    keywords: ['provider', 'api key', 'openai', 'anthropic', 'groq', 'nvidia', 'github', 'ollama', 'openrouter', 'model', '9router'],
    action: 'open-settings',
    settingsTab: 'providers',
  },
  {
    id: 'settings-appearance',
    label: 'Theme & Appearance',
    hint: 'Settings',
    icon: 'fa-solid fa-circle-half-stroke',
    kind: 'action',
    keywords: ['theme', 'dark', 'light', 'appearance', 'look'],
    action: 'open-settings',
    settingsTab: 'general',
  },
  {
    id: 'settings-layout',
    label: 'Layout & Ticker',
    hint: 'Settings',
    icon: 'fa-solid fa-table-columns',
    kind: 'action',
    keywords: ['layout', 'ticker', 'tape', 'sidebar', 'reset', 'defaults'],
    action: 'open-settings',
    settingsTab: 'general',
  },
  {
    id: 'open-about',
    label: 'About BOZ',
    hint: '',
    icon: 'fa-solid fa-circle-info',
    kind: 'action',
    keywords: ['about', 'version', 'update', 'info'],
    action: 'open-about',
  },
];

export function searchShellCommands(query: string): ShellCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...SHELL_COMMANDS];
  return SHELL_COMMANDS.filter(command => {
    const haystack = [command.label, command.hint, command.href ?? '', ...command.keywords]
      .join(' ')
      .toLowerCase();
    return needle.split(/\s+/).every(term => haystack.includes(term));
  });
}
