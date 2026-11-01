'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HostUpdateStatus } from './use-host-update';
import styles from './UpdatePromptModal.module.css';

interface UpdatePromptModalProps {
  status: HostUpdateStatus;
  install: () => Promise<string | null>;
  snooze: (version: string) => Promise<string | null>;
  isDesktop: boolean;
  onClose: () => void;
}

/** Installed build: the "from" side of the version change. */
const CURRENT_VERSION = process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.9.0';

function phaseTitle(phase: HostUpdateStatus['phase']): string {
  switch (phase) {
    case 'available':
      return 'Update available';
    case 'downloading':
      return 'Downloading update';
    case 'installing':
      return 'Installing update';
    case 'error':
      return 'Update did not finish';
    default:
      return "You're up to date";
  }
}

function phaseCopy(status: HostUpdateStatus): string {
  switch (status.phase) {
    case 'available':
      return 'Installing restarts BOZ in place. Your workspace, chats and settings stay exactly as they are.';
    case 'downloading':
      return status.percent == null
        ? 'Fetching the signed build. BOZ keeps running while it downloads.'
        : `Fetching the signed build, ${status.percent}% complete. BOZ keeps running while it downloads.`;
    case 'installing':
      return 'Applying the update now. BOZ closes and reopens on the new version by itself.';
    case 'error':
      return status.message ?? 'The update could not be started. Check your connection and try again.';
    default:
      return status.message ?? 'BOZ checks for updates once per launch. There is nothing to install right now.';
  }
}

/**
 * The desktop updater, rendered in-app. Deliberately not the About modal: it
 * offers explicit choices, and it renders every host phase on purpose, because
 * the host can open it from the tray "Check for updates" while a download is
 * already underway.
 *
 * It receives everything through props, never its own listener: the sidebar
 * owns the one subscription, so the prompt follows the host live while open.
 * ESC and the overlay click close; the X button closes without snoozing.
 */
export default function UpdatePromptModal({ status, install, snooze, isDesktop, onClose }: UpdatePromptModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Focus the dialog itself, never a button: a stray Enter must not install.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const runInstall = useCallback(async () => {
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

  const later = useCallback(async () => {
    const target = status.version;
    if (!target) {
      onClose();
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const problem = await snooze(target);
      if (problem) {
        setActionError(problem);
      } else {
        // The choice is made; the prompt has nothing left to ask.
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }, [snooze, status.version, onClose]);

  const percentage = status.percent;
  const updateRunning = status.phase === 'downloading' || status.phase === 'installing';
  const showsVersion = status.version != null && status.phase !== 'idle';

  // Buttons are gone while the update runs so a second click cannot start
  // another install; the host rejects concurrent installs anyway.
  let actions: ReactNode = null;
  if (!updateRunning) {
    if (isDesktop && status.phase === 'available') {
      actions = (
        <>
          <button type="button" className={styles.primary} onClick={() => void runInstall()} disabled={busy}>
            {busy ? 'Starting' : 'Update now'}
          </button>
          <button type="button" className={styles.secondary} onClick={() => void later()} disabled={busy}>
            Later
          </button>
        </>
      );
    } else if (status.phase === 'error') {
      actions = (
        <>
          <button type="button" className={styles.primary} onClick={() => void runInstall()} disabled={busy}>
            Try again
          </button>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Close
          </button>
        </>
      );
    } else {
      actions = (
        <button type="button" className={styles.secondary} onClick={onClose}>
          Close
        </button>
      );
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <span className={styles.mark} aria-hidden="true">
            <img src="/logo-boz-transparant-white.png" alt="" />
          </span>
          <span className={styles.eyebrow}>BOZ Desktop</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>

        <div className={styles.body}>
          <h2 id={titleId} className={styles.title}>{phaseTitle(status.phase)}</h2>

          {showsVersion ? (
            <div className={styles.versions} aria-label={`Version ${CURRENT_VERSION} to ${status.version}`}>
              <span className={styles.versionChip}>v{CURRENT_VERSION}</span>
              <span className={styles.versionArrow} aria-hidden="true">&rarr;</span>
              <span className={`${styles.versionChip} ${styles.versionNext}`}>v{status.version}</span>
            </div>
          ) : (
            <div className={styles.versions} aria-label={`Version ${CURRENT_VERSION}`}>
              <span className={styles.versionChip}>v{CURRENT_VERSION}</span>
            </div>
          )}

          <p className={styles.copy}>{phaseCopy(status)}</p>

          {status.phase === 'downloading' && (
            <div className={styles.progressBlock}>
              <div
                className={styles.progress}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage ?? undefined}
                aria-label={percentage == null ? 'Downloading update' : `${percentage}% downloaded`}
              >
                <span
                  className={percentage == null ? styles.progressPulse : undefined}
                  style={{ width: `${percentage ?? 30}%` }}
                />
              </div>
              <div className={styles.progressMeta}>
                <span>{percentage == null ? 'Starting' : `${percentage}%`}</span>
                <span>Signed build</span>
              </div>
            </div>
          )}

          {status.phase === 'idle' && status.snoozedVersion && (
            <p className={styles.note}>
              {`Version v${status.snoozedVersion} was set aside. It prompts again next launch.`}
            </p>
          )}

          {actionError && (
            <p className={styles.alert} role="alert">{actionError}</p>
          )}

          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </div>
    </div>
  );
}
