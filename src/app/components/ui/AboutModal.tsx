'use client';

import { useEffect, useId } from 'react';
import styles from './AboutModal.module.css';

/** Fallback mirrors the sidebar footer; the build rewrites both at package time. */
const CURRENT_VERSION = process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.9.0';

interface AboutModalProps {
  onClose: () => void;
}

/**
 * What is installed, and nothing else.
 *
 * Updates deliberately live outside this dialog: About answers "what is this
 * app", while the updater answers "what should I do about the new build".
 * The profile menu carries the Update entry that opens it.
 */
export default function AboutModal({ onClose }: AboutModalProps) {
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <span className={styles.mark} aria-hidden="true">
            <img src="/logo-boz-transparant-white.png" alt="" />
          </span>
          <span className={styles.eyebrow}>About</span>
          <button type="button" className={styles.closeIcon} onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.identity}>
            <h2 id={titleId} className={styles.name}>BOZ Intelligence</h2>
            <p className={styles.meta}>
              <span>Desktop app</span>
              <span className={styles.sep} aria-hidden="true">·</span>
              <span className={styles.version}>v{CURRENT_VERSION}</span>
            </p>
          </div>

          <p className={styles.copy}>
            Market intelligence for a single desk. Your workspace, chats and settings stay on this machine.
          </p>
        </div>

        <footer className={styles.foot}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
