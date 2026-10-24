'use client';

import { useCallback, useState } from 'react';
import styles from './DesktopUpdateControl.module.css';
import { useHostUpdate } from './use-host-update';

// The status shape and its normalization moved into the shared hook; these
// re-exports keep every existing importer (tests, sidebar) working from here.
export { IDLE_UPDATE_STATUS, normalizeUpdateStatus } from './use-host-update';
export type { HostUpdatePhase, HostUpdateStatus } from './use-host-update';

export default function DesktopUpdateControl({ version }: { version: string }) {
  const { status, install, snooze, isDesktop } = useHostUpdate();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const installUpdate = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      // The hook hands back a display-ready error string, or null on success.
      const problem = await install();
      if (problem) setActionError(problem);
    } finally {
      setBusy(false);
    }
  }, [install]);

  const remindLater = useCallback(async () => {
    const target = status.version;
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      const problem = await snooze(target);
      if (problem) setActionError(problem);
    } finally {
      setBusy(false);
    }
  }, [snooze, status.version]);

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
            // The host reports what a finished manual check found. Prefer it
            // over the generic idle copy so the user is not told twice.
            : status.message
              ? status.message
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
            onClick={() => void installUpdate()}
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
