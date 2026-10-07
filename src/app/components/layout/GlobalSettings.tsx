'use client';

import { useState, useEffect } from 'react';
import SettingsModal from '../ui/SettingsModal';
import type { SettingsTab } from './shell-commands';

const SETTINGS_TABS: SettingsTab[] = ['profile', 'providers', 'general'];

export default function GlobalSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<SettingsTab>('profile');

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab;
      setInitialTab(
        typeof tab === 'string' && (SETTINGS_TABS as string[]).includes(tab)
          ? (tab as SettingsTab)
          : 'profile',
      );
      setSettingsOpen(true);
    };
    window.addEventListener('boz_open_settings', handleOpenSettings);
    return () => window.removeEventListener('boz_open_settings', handleOpenSettings);
  }, []);

  return <SettingsModal isOpen={settingsOpen} initialTab={initialTab} onClose={() => setSettingsOpen(false)} />;
}
