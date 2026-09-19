export const SHELL_NAVIGATION_TARGETS = {
  newChat: '/chat',
  dashboard: '/',
} as const;

export type ShellNavigationCommand = keyof typeof SHELL_NAVIGATION_TARGETS;

export function getShellNavigationTarget(command: ShellNavigationCommand): string {
  return SHELL_NAVIGATION_TARGETS[command];
}

const routeLabels: Array<{ prefix: string; label: string }> = [
  { prefix: '/chat', label: 'Chat Agent' },
  { prefix: '/idx-scanner', label: 'IDX Scanner' },
  { prefix: '/analyze/intraday', label: 'Intraday Analysis' },
  { prefix: '/analyze/longterm', label: 'Long-term Analysis' },
  { prefix: '/news-intel', label: 'News Intel' },
  { prefix: '/dashboard', label: 'Market Dashboard' },
];

export function getShellRouteLabel(pathname: string): string {
  return routeLabels.find(route => pathname.startsWith(route.prefix))?.label ?? 'Dashboard';
}
