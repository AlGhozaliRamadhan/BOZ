'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import AppMenuBar from './AppMenuBar';
import GlobalSettings from './GlobalSettings';
import MarketTicker from './MarketTicker';
import Sidebar from './Sidebar';
import {
  DEFAULT_SHELL_PREFERENCES,
  readShellPreferences,
  writeShellPreferences,
  type ShellPreferences,
} from './shell-state';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [preferences, setPreferences] = useState<ShellPreferences>(DEFAULT_SHELL_PREFERENCES);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setPreferences(readShellPreferences(window.localStorage));
    } catch {
      setPreferences(DEFAULT_SHELL_PREFERENCES);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      writeShellPreferences(window.localStorage, preferences);
    } catch {
      // Layout preferences are optional and should never prevent the app from loading.
    }
  }, [hydrated, preferences]);

  const updatePreferences = (patch: Partial<ShellPreferences>) => {
    setPreferences(current => ({ ...current, ...patch }));
  };

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setMobileSidebarOpen(current => !current);
      return;
    }
    setPreferences(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
  }, []);

  const resetLayout = () => setPreferences(DEFAULT_SHELL_PREFERENCES);

  return (
    <div className={`app-shell${preferences.sidebarCollapsed ? ' app-shell-sidebar-collapsed' : ''}${preferences.tickerVisible ? '' : ' app-shell-ticker-hidden'}${mobileSidebarOpen ? ' app-shell-mobile-sidebar-open' : ''}`}>
      <AppMenuBar
        sidebarCollapsed={preferences.sidebarCollapsed}
        tickerVisible={preferences.tickerVisible}
        onToggleSidebar={toggleSidebar}
        onToggleTicker={() => updatePreferences({ tickerVisible: !preferences.tickerVisible })}
        onResetLayout={resetLayout}
      />
      <div className="app-layout">
        {mobileSidebarOpen && (
          <button type="button" className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close navigation" />
        )}
        <GlobalSettings />
        <Sidebar
          collapsed={preferences.sidebarCollapsed}
          mobileOpen={mobileSidebarOpen}
          onToggle={toggleSidebar}
        />
        <div className="app-main">
          <MarketTicker visible={preferences.tickerVisible} />
          <main className="app-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
