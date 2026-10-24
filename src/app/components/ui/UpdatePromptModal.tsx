'use client';

import { useCallback, useEffect, useState } from 'react';
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

/**
 * The real update prompt, rendered in-app. Deliberately not the About modal:
 * it offers explicit choices, and it renders every host phase on purpose,
 * because the host can open it from the tray "Check for updates" while a
 * download is already underway.
 *
 * It receives everything through props, never its own listener: the sidebar
 * owns the one subscription, so the prompt follows the host live while open.
 * ESC and the overlay click close; the X button closes without snoozing.
 */
export default function UpdatePromptModal({ status, install, snooze, isDesktop, onClose }: UpdatePromptModalProps) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  let body: ReactNode;
  if (status.phase === 'available') {
    body = (
      <p className={styles['update-prompt-copy']}>
        {status.version
          ? `BOZ v${status.version} is ready to install. Installing applies it in place and restarts BOZ; your workspace and settings are kept.`
          : 'A BOZ update is ready to install. Installing applies it in place and restarts BOZ; your workspace and settings are kept.'}
      </p>
    );
  } else if (status.phase === 'downloading') {
    body = (
      <>
        <div
          className={styles['update-prompt-progress']}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage ?? undefined}
          aria-label={percentage == null ? 'Downloading update' : `${percentage}% downloaded`}
        >
          <span style={{ width: `${percentage ?? 15}%` }} />
        </div>
        <p className={styles['update-prompt-copy']}>
          {percentage == null
            ? 'Downloading the signed update.'
            : `Downloading the signed update, ${percentage}%.`}
        </p>
      </>
    );
  } else if (status.phase === 'installing') {
    body = (
      <p className={styles['update-prompt-copy']}>Applying the update. BOZ will restart on its own.</p>
    );
  } else if (status.phase === 'error') {
    body = (
      <p className={styles['update-prompt-copy']} role="alert">
        {status.message ?? 'The update could not be reached.'}
      </p>
    );
  } else {
    body = (
      <>
        <p className={styles['update-prompt-copy']}>
          {status.message ?? 'BOZ checks for updates once per launch. Nothing to do right now.'}
        </p>
        {status.snoozedVersion && (
          <p className={styles['update-prompt-note']}>
            {`BOZ v${status.snoozedVersion} was set aside. It prompts again next launch.`}
          </p>
        )}
      </>
    );
  }

  // Buttons are gone while the update runs so a second click cannot start
  // another install; the host rejects concurrent installs anyway.
  let actions: ReactNode = null;
  if (isDesktop && !updateRunning) {
    if (status.phase === 'available') {
      actions = (
        <>
          <button type="button" className={styles['update-prompt-primary']} onClick={() => void runInstall()} disabled={busy}>
            Install update
          </button>
          <button type="button" className={styles['update-prompt-secondary']} onClick={() => void later()} disabled={busy}>
            Later
          </button>
        </>
      );
    } else if (status.phase === 'error') {
      actions = (
        <>
          <button type="button" className={styles['update-prompt-primary']} onClick={() => void runInstall()} disabled={busy}>
            Retry
          </button>
          <button type="button" className={styles['update-prompt-secondary']} onClick={onClose}>
            Close
          </button>
        </>
      );
    } else if (status.phase === 'idle') {
      actions = (
        <button type="button" className={styles['update-prompt-secondary']} onClick={onClose}>
          Close
        </button>
      );
    }
  }

  return (
    <div className="update-modal-overlay" onClick={onClose}>
      <div className="update-modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="update-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              {status.phase === 'available' ? 'BOZ update available' : 'BOZ update'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="update-modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
            {body}
            {actionError && (
              <p className={styles['update-prompt-alert']} role="alert">{actionError}</p>
            )}
          </div>
          {actions && <div className={styles['update-prompt-foot']}>{actions}</div>}
        </div>
      </div>
    </div>
  );
}
