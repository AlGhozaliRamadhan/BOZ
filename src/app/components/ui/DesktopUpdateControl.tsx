'use client';

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import styles from './DesktopUpdateControl.module.css';

/**
 * Phase reported by the desktop host.
 *
 * The host owns the update flow, not this component. It used to run its own
 * independent `check()` from here while Rust ALSO prompted with a native
 * dialog, so the two UIs could disagree and the user got no download progress
 * at all (the Rust progress callback was a no-op). Now the host is the single
 * source of truth: it publishes status, this renders it.
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
}

const UPDATE_EVENT = 'boz://update-status';

export const IDLE_UPDATE_STATUS: HostUpdateStatus = {
  phase: 'idle',
  version: null,
  percent: null,
  message: null,
  snoozedVersion: null,
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
  };
}

export default function DesktopUpdateControl({ version }: { version: string }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [status, setStatus] = useState<HostUpdateStatus>(IDLE_UPDATE_STATUS);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const install = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await invoke('install_available_update');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The update could not start.');
    } finally {
      setBusy(false);
    }
  }, []);

  const remindLater = useCallback(async () => {
    const target = status.version;
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      await invoke('snooze_update', { version: target });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save your choice.');
    } finally {
      setBusy(false);
    }
  }, [status.version]);

  const percentage = status.percent;
  const updateRunning = status.phase === 'downloading' || status.phase === 'installing';

  const statusPill = !isDesktop
    ? { label: 'Browser preview', tone: 'muted' as const }
    : status.phase === 'available'
      ? { label: `v${status.version} ready`, tone: 'info' as const }
      : updateRunning
        ? { label: 'Updating…', tone: 'info' as const }
        : status.phase === 'error'
          ? { label: 'Update failed', tone: 'bad' as const }
          : status.snoozedVersion
            ? { label: 'Up to date', tone: 'ok' as const }
            : { label: 'Desktop app', tone: 'muted' as const };

  const statusCopy = !isDesktop
    ? 'You are previewing BOZ in the browser. Updates ship with the installed Windows desktop app, so there is nothing to do here.'
    : status.phase === 'available'
      ? `BOZ v${status.version} is ready. Installing applies it in place and restarts BOZ, so you keep your workspace and settings.`
      : status.phase === 'downloading'
        ? percentage == null
          ? 'Downloading the signed update.'
          : `Downloading the signed update, ${percentage}%.`
        : status.phase === 'installing'
          ? 'Applying the update. BOZ will restart on its own.'
          : status.phase === 'error'
            ? status.message ?? 'The update service could not be reached.'
            : status.snoozedVersion
              ? `You are on the latest version. BOZ v${status.snoozedVersion} was set aside. Check for updates any time from here.`
              : 'BOZ checks for updates once per launch. Nothing to do right now.';

  return (
    <section className={styles['desktop-update-control']} aria-live="polite">
      <div className={styles['desktop-update-control__head']}>
        <div className={styles['desktop-update-control__identity']}>
          <img src="/logo-boz-transparant-white.png" alt="" aria-hidden="true" />
          <strong>BOZ Desktop</strong>
          <span className={styles['desktop-update-control__version']}>v{version}</span>
        </div>
        <span className={`${styles['desktop-update-control__pill']} ${styles[`desktop-update-control__pill--${statusPill.tone}`]}`}>
          {statusPill.label}
        </span>
      </div>

      <p className={styles['desktop-update-control__copy']}>{statusCopy}</p>

      {status.phase === 'downloading' && (
        <div
          className={styles['desktop-update-control__progress']}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage ?? undefined}
          aria-label={percentage == null ? 'Downloading update' : `${percentage}% downloaded`}
        >
          <span style={{ width: `${percentage ?? 15}%` }} />
        </div>
      )}

      {actionError && (
        <p className={styles['desktop-update-control__copy']} role="alert">{actionError}</p>
      )}

      {isDesktop && status.phase === 'available' && (
        <div className={styles['desktop-update-control__foot']}>
          <button
            type="button"
            className={styles['desktop-update-control__button']}
            onClick={() => void install()}
            disabled={busy}
          >
            Install update
          </button>
          <button
            type="button"
            className={styles['desktop-update-control__button']}
            onClick={() => void remindLater()}
            disabled={busy}
          >
            Remind me next launch
          </button>
        </div>
      )}
    </section>
  );
}