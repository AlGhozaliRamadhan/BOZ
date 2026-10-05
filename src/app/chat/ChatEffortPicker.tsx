'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EFFORT_OPTIONS,
  type Effort,
  getEffort,
  setEffort,
  CHAT_OPTIONS_EVENT,
} from '../../shared/chat-options';
import styles from './Pickers.module.css';

const EFFORT_DESCRIPTIONS: Record<Effort, string> = {
  Low: 'Fast & concise responses',
  Medium: 'Standard balanced reasoning',
  High: 'Deep multi-pass verification',
  Extra: 'Exhaustive data synthesis',
  Max: 'Maximum compute & stress-test',
};

export default function ChatEffortPicker() {
  const [open, setOpen] = useState(false);
  const [effort, setEffortState] = useState<Effort>('Medium');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEffortState(getEffort());
    const sync = () => {
      setEffortState(getEffort());
    };
    window.addEventListener(CHAT_OPTIONS_EVENT, sync);
    return () => window.removeEventListener(CHAT_OPTIONS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const selectEffort = (val: Effort) => {
    setEffort(val);
    setEffortState(val);
    setOpen(false);
  };

  return (
    <div className={styles['chat-effort-picker']} ref={rootRef}>
      <button
        type="button"
        className={`${styles['chat-effort-trigger']} ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Thinking effort level"
        aria-label={`Thinking effort: ${effort}`}
        aria-expanded={open}
      >
        {effort === 'Max' && (
          <i className="fa-solid fa-fire" style={{ fontSize: '11px', color: '#ff793f' }}></i>
        )}
        <span className={styles['chat-effort-label']}>{effort}</span>
        <i className="fa-solid fa-chevron-up" style={{ fontSize: '8px', opacity: 0.4 }}></i>
      </button>

      {open && (
        <div className={`${styles['chat-effort-menu']} animate-fadeIn`}>
          <div className={styles['chat-effort-menu-header']}>
            <span>Thinking Effort</span>
          </div>
          {EFFORT_OPTIONS.map((opt) => {
            const desc = EFFORT_DESCRIPTIONS[opt];
            const isSelected = opt === effort;
            return (
              <button
                key={opt}
                type="button"
                className={`${styles['chat-effort-option']} ${isSelected ? 'selected' : ''}`}
                onClick={() => selectEffort(opt)}
              >
                <div className={styles['chat-effort-option-info']}>
                  <div className={styles['chat-effort-option-name']}>
                    <span>{opt}</span>
                    {isSelected && (
                      <i
                        className="fa-solid fa-check"
                        style={{ fontSize: '11px', color: 'var(--accent-cyan, #00e5ff)' }}
                      ></i>
                    )}
                  </div>
                  <div className={styles['chat-effort-option-desc']}>{desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
