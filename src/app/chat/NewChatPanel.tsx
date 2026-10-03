'use client';

import { useEffect, useState } from 'react';
import {
  EFFORT_OPTIONS,
  getEffort,
  setEffort,
  CHAT_OPTIONS_EVENT,
  type Effort,
} from '../../shared/chat-options';

export const LAST_TICKER_STORAGE_KEY = 'boz_last_ticker';

type RiskMode = 'auto' | 'on' | 'off';

const RISK_OPTIONS: { value: RiskMode; label: string; desc: string }[] = [
  { value: 'auto', label: 'Auto', desc: 'Model decides when risk framing applies' },
  { value: 'on', label: 'On', desc: 'Always include risk framing' },
  { value: 'off', label: 'Off', desc: 'Skip risk framing' },
];

const EFFORT_DESCRIPTIONS: Record<Effort, string> = {
  Low: 'Fast & concise',
  Medium: 'Balanced reasoning',
  High: 'Deep verification',
  Extra: 'Exhaustive synthesis',
  Max: 'Maximum compute',
};

function readLastTicker(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(LAST_TICKER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

interface NewChatPanelProps {
  onStart: (command: string) => void;
}

export default function NewChatPanel({ onStart }: NewChatPanelProps) {
  const [ticker, setTicker] = useState('');
  const [effort, setEffortState] = useState<Effort>('Medium');
  const [riskMode, setRiskMode] = useState<RiskMode>('auto');
  const [savingRisk, setSavingRisk] = useState(false);

  useEffect(() => {
    setTicker(readLastTicker());
    const syncEffort = () => setEffortState(getEffort());
    syncEffort();
    window.addEventListener(CHAT_OPTIONS_EVENT, syncEffort);
    const loadRisk = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (data.riskMode === 'on' || data.riskMode === 'off' || data.riskMode === 'auto') {
          setRiskMode(data.riskMode);
        }
      } catch {
        // keep default
      }
    };
    void loadRisk();
    return () => window.removeEventListener(CHAT_OPTIONS_EVENT, syncEffort);
  }, []);

  const persistTicker = (value: string) => {
    const clean = value.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '').slice(0, 16);
    setTicker(clean);
    try {
      if (clean) window.localStorage.setItem(LAST_TICKER_STORAGE_KEY, clean);
    } catch {
      // persistence is optional
    }
  };

  const changeEffort = (value: Effort) => {
    setEffort(value);
    setEffortState(value);
  };

  const changeRiskMode = async (value: RiskMode) => {
    setRiskMode(value);
    setSavingRisk(true);
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
      setSavingRisk(false);
    }
  };

  const start = (command: string) => {
    if (ticker.trim()) {
      try {
        window.localStorage.setItem(LAST_TICKER_STORAGE_KEY, ticker.trim().toUpperCase());
      } catch {
        // persistence is optional
      }
    }
    onStart(command);
  };

  const sym = ticker.trim().toUpperCase() || 'NVDA';

  return (
    <div className="new-chat-panel animate-fadeIn">
      <div className="new-chat-panel__row">
        <label className="new-chat-panel__field">
          <span className="new-chat-panel__label">Ticker</span>
          <input
            type="text"
            className="new-chat-panel__input"
            value={ticker}
            maxLength={16}
            onChange={(e) => persistTicker(e.target.value)}
            placeholder="NVDA"
            spellCheck={false}
            autoComplete="off"
            aria-label="Analysis ticker"
          />
        </label>

        <div className="new-chat-panel__field">
          <span className="new-chat-panel__label">Effort</span>
          <div className="new-chat-panel__pills" role="radiogroup" aria-label="Analysis effort">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={opt === effort}
                title={EFFORT_DESCRIPTIONS[opt]}
                className={`new-chat-panel__pill${opt === effort ? ' active' : ''}`}
                onClick={() => changeEffort(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="new-chat-panel__field">
          <span className="new-chat-panel__label">Risk framing</span>
          <div className="new-chat-panel__pills" role="radiogroup" aria-label="Risk framing">
            {RISK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={opt.value === riskMode}
                title={opt.desc}
                disabled={savingRisk}
                className={`new-chat-panel__pill${opt.value === riskMode ? ' active' : ''}`}
                onClick={() => void changeRiskMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="new-chat-panel__actions">
        <button type="button" className="new-chat-panel__action" onClick={() => start(`/intraday ${sym}`)}>
          <i className="fa-solid fa-chart-line" />
          <span>Intraday {sym}</span>
        </button>
        <button type="button" className="new-chat-panel__action" onClick={() => start(`/longterm ${sym}`)}>
          <i className="fa-solid fa-scale-balanced" />
          <span>Long-term {sym}</span>
        </button>
        <button type="button" className="new-chat-panel__action" onClick={() => start('/newsintel')}>
          <i className="fa-solid fa-newspaper" />
          <span>News intel</span>
        </button>
      </div>
    </div>
  );
}
