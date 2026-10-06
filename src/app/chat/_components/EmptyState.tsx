import styles from './EmptyState.module.css';
import type { MarketQuote } from '../_lib/chat-types';

interface EmptyStateSuggestion {
  text: string;
  action: string;
}

const SUGGESTIONS: EmptyStateSuggestion[] = [
  { text: 'Global Market Outlook', action: 'What is the current global market outlook across equities, bonds, and macro regimes?' },
  { text: 'Intraday NVDA', action: '/intraday NVDA' },
  { text: 'Scan IDX Momentum', action: 'Scan Indonesia stocks for high-probability momentum and breakout candidates' },
  { text: 'Market News Intel', action: '/newsintel' },
  { text: 'Longterm AAPL', action: '/longterm AAPL' },
  { text: 'Crypto & Bitcoin Status', action: 'What is the current Bitcoin price action and crypto crowd sentiment?' },
];

interface EmptyStateProps {
  greeting: string;
  quote: MarketQuote | null;
  onSuggest: (action: string) => void;
}

export default function EmptyState({ greeting, quote, onSuggest }: EmptyStateProps) {
  return (
    <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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
