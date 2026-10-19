// ─── chat/_hooks/useSetupState.ts ────────────────────────────────────────────
// Whether the active provider can actually start a generation.
//
// `GET /api/settings` computes this from the same rules the chat engine's
// preflight uses, so the UI and the engine can't disagree: a fresh install
// shows the "set up a model to use" state instead of a provider that would
// reject the first message. The hook re-reads on `boz_settings_updated`, so
// the state clears the moment a credential/model is saved.
'use client';

import { useEffect, useState } from 'react';

export interface ProviderSetupState {
  configured: boolean;
  issue: 'no-credential' | 'no-model' | null;
}

export function useSetupState(): { setup: ProviderSetupState | null } {
  const [setup, setSetup] = useState<ProviderSetupState | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const bump = () => setGeneration((g) => g + 1);
    window.addEventListener('boz_settings_updated', bump);
    return () => window.removeEventListener('boz_settings_updated', bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data && typeof data.setup === 'object' && data.setup !== null) {
          setSetup({
            configured: Boolean(data.setup.configured),
            issue: data.setup.issue ?? null,
          });
        }
      } catch {
        // Setup state is a nudge, not a gate — keep the last known value.
      }
    })();
    return () => { cancelled = true; };
  }, [generation]);

  return { setup };
}
