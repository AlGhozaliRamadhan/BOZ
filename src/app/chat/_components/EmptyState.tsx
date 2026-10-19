import styles from './EmptyState.module.css';
import type { MarketQuote } from '../_lib/chat-types';
import type { ProviderSetupState } from '../_hooks/useSetupState';

interface EmptyStateSuggestion {
  text: string;
  action: string;
}

// Suggestion chips are skill triggers — each action is a `/command` resolved
// by `.boz/skills/<name>/SKILL.md`, not a hardcoded handler.
const SUGGESTIONS: EmptyStateSuggestion[] = [
  { text: 'Global Market Outlook', action: '/global' },
  { text: 'Intraday NVDA', action: '/intraday NVDA' },
  { text: 'Scan IDX Momentum', action: '/idx' },
  { text: 'Market News Intel', action: '/newsintel' },
  { text: 'Longterm AAPL', action: '/longterm AAPL' },
  { text: 'Crowd Sentiment', action: '/sentiment' },
];

interface EmptyStateProps {
  greeting: string;
  quote: MarketQuote | null;
  onSuggest: (action: string) => void;
  /** Active provider setup truth from /api/settings; null while loading. */
  setup?: ProviderSetupState | null;
  onOpenSettings: () => void;
}

export default function EmptyState({ greeting, quote, onSuggest, setup, onOpenSettings }: EmptyStateProps) {
  return (
    <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* First-run setup card: shown while nothing usable is configured. */}
      {setup && !setup.configured && (
        <div className={styles['setup-callout']} role="status">
          <div className={styles['setup-callout-heading']}>
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            <strong>A model isn't set up yet</strong>
          </div>
          <p className={styles['setup-callout-text']}>
            Chats need a provider credential and a model. Connect one (OpenRouter, 9router, GitHub, OpenAI, Groq&hellip;) in provider settings.
          </p>
          <button type="button" className={styles['setup-callout-button']} onClick={onOpenSettings}>
            <i className="fa-solid fa-gear" aria-hidden="true"></i>
            Set up model
          </button>
        </div>
      )}
      <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
        <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: '16px' }} />
      </div>
      <h2 className={styles['chat-empty-title']}>{greeting}</h2>

      {quote && (
        <div className={`${styles['chat-empty-quote']} animate-fadeIn`}>
          &ldquo;{quote.text}&rdquo;
          <span className={styles['chat-empty-quote-author']}> — {quote.author}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '640px' }}>
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSuggest(s.action)}
            className={styles['suggestion-chip']}
          >
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}
