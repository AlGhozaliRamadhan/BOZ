'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Pickers.module.css';

type RiskMode = 'auto' | 'on' | 'off';

const RISK_OPTIONS: { value: RiskMode; name: string; desc: string }[] = [
  { value: 'auto', name: 'Auto', desc: 'Model decides when risk framing applies' },
  { value: 'on', name: 'On', desc: 'Always include risk framing in analysis' },
  { value: 'off', name: 'Off', desc: 'Skip risk framing' },
];

const RISK_LABEL: Record<RiskMode, string> = {
  auto: 'Risk auto',
  on: 'Risk on',
  off: 'Risk off',
};

export default function ChatRiskPicker() {
  const [open, setOpen] = useState(false);
  const [riskMode, setRiskMode] = useState<RiskMode>('auto');
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && (data.riskMode === 'on' || data.riskMode === 'off' || data.riskMode === 'auto')) {
          setRiskMode(data.riskMode);
        }
      } catch {
        // keep default
      }
    };
    void load();
    return () => { cancelled = true; };
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

  const selectRiskMode = async (value: RiskMode) => {
    setRiskMode(value);
    setOpen(false);
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskMode: value }),
      });
      window.dispatchEvent(new Event('boz_settings_updated'));
    } catch {
      // risk mode applies server-side; keep local selection regardless
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles['chat-effort-picker']} ref={rootRef}>
      <button
        type="button"
        className={`${styles['chat-effort-trigger']} ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Risk framing for analysis"
        aria-label={`Risk framing: ${riskMode}`}
        aria-expanded={open}
        disabled={saving}
      >
        <span className={styles['chat-effort-label']}>{RISK_LABEL[riskMode]}</span>
        <i className="fa-solid fa-chevron-up" style={{ fontSize: '8px', opacity: 0.4 }}></i>
      </button>

      {open && (
        <div className={`${styles['chat-effort-menu']} animate-fadeIn`}>
          <div className={styles['chat-effort-menu-header']}>
            <span>Risk Framing</span>
          </div>
          {RISK_OPTIONS.map((opt) => {
            const isSelected = opt.value === riskMode;
            return (
              <button
                key={opt.value}
                type="button"
                className={`${styles['chat-effort-option']} ${isSelected ? 'selected' : ''}`}
                onClick={() => void selectRiskMode(opt.value)}
              >
                <div className={styles['chat-effort-option-info']}>
                  <div className={styles['chat-effort-option-name']}>
                    <span>{opt.name}</span>
                    {isSelected && (
                      <i
                        className="fa-solid fa-check"
                        style={{ fontSize: '11px', color: 'var(--accent-cyan, #00e5ff)' }}
                      ></i>
                    )}
                  </div>
                  <div className={styles['chat-effort-option-desc']}>{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
