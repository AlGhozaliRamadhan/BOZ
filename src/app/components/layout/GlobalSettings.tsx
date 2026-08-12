'use client';

import { useState, useEffect } from 'react';
import SettingsModal from '../ui/SettingsModal';

export default function GlobalSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    window.addEventListener('boz_open_settings', handleOpenSettings);
    return () => window.removeEventListener('boz_open_settings', handleOpenSettings);
  }, []);

  return <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />;
}
