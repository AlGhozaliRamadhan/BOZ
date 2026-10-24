'use client';

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

/**
 * Phase reported by the desktop host.
 *
 * The host owns the update flow, not the webview. It is the single source of
 * truth: it publishes status, the UI renders it.
 */
export type HostUpdatePhase =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

export interface HostUpdateStatus {
  phase: HostUpdatePhase;
  version: string | null;
  percent: number | null;
  message: string | null;
  snoozedVersion: string | null;
  /**
   * Host asks the webview to surface the update prompt now. Set when a check
   * runs from the tray while the window may be hidden, so the request still
   * lands once the webview has booted. The consumer clears it through
   * `clear_update_open_request` after it has opened the prompt.
   */
  openRequested: boolean;
}

const UPDATE_EVENT = 'boz://update-status';

export const IDLE_UPDATE_STATUS: HostUpdateStatus = {
  phase: 'idle',
  version: null,
  percent: null,
  message: null,
  snoozedVersion: null,
  openRequested: false,
};

/** Drops anything the host has not reported so a stale payload can't render. */
export function normalizeUpdateStatus(raw: unknown): HostUpdateStatus {
  if (!raw || typeof raw !== 'object') return IDLE_UPDATE_STATUS;
  const candidate = raw as Partial<HostUpdateStatus>;
  const phases: HostUpdatePhase[] = ['idle', 'available', 'downloading', 'installing', 'error'];
  const phase = phases.includes(candidate.phase as HostUpdatePhase)
    ? (candidate.phase as HostUpdatePhase)
    : 'idle';
  const percent = typeof candidate.percent === 'number' && Number.isFinite(candidate.percent)
    ? Math.max(0, Math.min(100, Math.round(candidate.percent)))
    : null;
  return {
    phase,
    version: typeof candidate.version === 'string' && candidate.version ? candidate.version : null,
    percent,
    message: typeof candidate.message === 'string' && candidate.message ? candidate.message : null,
    snoozedVersion:
      typeof candidate.snoozedVersion === 'string' && candidate.snoozedVersion
        ? candidate.snoozedVersion
        : null,
    // The host hand-builds this JSON: only a literal true counts as a request.
    openRequested: candidate.openRequested === true,
  };
}

/**
 * Claims the once-per-browser-session startup prompt slot, and reports whether
 * THIS call was the one that claimed it.
 *
 * Read and write happen as one move so two racing consumers cannot both open.
 * It throws when the storage is unusable; callers treat that as "already
 * prompted", so a broken webview storage never produces the startup prompt on
 * its own (only an explicit event may).
 */
export function claimStartupPrompt(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
): boolean {
  if (storage.getItem(key) === 'true') return false;
  storage.setItem(key, 'true');
  return true;
}

/**
 * The webview's single window into the desktop host's update state.
 *
 * Sidebar and the About control both render from the same host status. Before
 * this hook each subscribed on its own, so the two listeners could drift one
 * refactor at a time; now both consume this. `install` and `snooze` never
 * reject: they resolve with a display-ready error message, or null when the
 * host accepted the call.
 */
export function useHostUpdate(): {
  status: HostUpdateStatus;
  install: () => Promise<string | null>;
  snooze: (version: string) => Promise<string | null>;
  isDesktop: boolean;
} {
  const [isDesktop, setIsDesktop] = useState(false);
  const [status, setStatus] = useState<HostUpdateStatus>(IDLE_UPDATE_STATUS);

  useEffect(() => {
    const desktop = isTauri();
    setIsDesktop(desktop);
    if (!desktop) return undefined;

    let cancelled = false;
    // Read the current state first: the host can finish a check while the app
    // is still booting, and that offer must survive the UI mounting late.
    void invoke<unknown>('update_status')
      .then((raw) => { if (!cancelled) setStatus(normalizeUpdateStatus(raw)); })
      .catch(() => undefined);

    const unlisten = listen<unknown>(UPDATE_EVENT, (event) => {
      if (!cancelled) setStatus(normalizeUpdateStatus(event.payload));
    }).then((off) => () => { cancelled = true; off(); }).catch(() => () => { cancelled = true; });

    return () => { cancelled = true; void unlisten.then((off) => off()); };
  }, []);

  const install = useCallback(async (): Promise<string | null> => {
    try {
      await invoke('install_available_update');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'The update could not start.';
    }
  }, []);

  const snooze = useCallback(async (version: string): Promise<string | null> => {
    try {
      await invoke('snooze_update', { version });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not save your choice.';
    }
  }, []);

  return { status, install, snooze, isDesktop };
}
