'use client';

import { useEffect, useMemo, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';
import ChatEffortPicker from './ChatEffortPicker';
import ChatModelPicker from './ChatModelPicker';
import ChatRiskPicker from './ChatRiskPicker';
import { parseTickerArgPrompt } from '@/shared/boz-skills';
import { SYMBOL_MARKET_LABEL, type SymbolMarket } from '@/shared/symbol-search';
import { useLoadMoreOnScroll, useSymbolSearch } from '@/app/lib/hooks';
import styles from './Composer.module.css';

interface SlashMenuItem {
  cmd: string;
  title: string;
  desc: string;
  icon: string;
  needsTicker?: boolean;
}

interface TickerResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
  market?: string;
}

/** Fallback when the skills API is unreachable. Mirrors the committed BOZ skill frontmatter. */
const FALLBACK_SLASH_COMMANDS: SlashMenuItem[] = [
  { cmd: '/intraday ', title: 'Intraday', desc: 'Live intraday analysis & key levels [ticker]', icon: 'fa-chart-line', needsTicker: true },
  { cmd: '/longterm ', title: 'Longterm', desc: 'Fundamental analysis & long-term outlook [ticker]', icon: 'fa-scale-balanced', needsTicker: true },
  { cmd: '/price ', title: 'Price', desc: 'Quick live price check for any asset [ticker]', icon: 'fa-tag', needsTicker: true },
  { cmd: '/newsintel ', title: '/newsintel', desc: 'Scan latest market headlines', icon: 'fa-newspaper', needsTicker: false },
];

interface ComposerProps {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  loading: boolean;
  stopping?: boolean;
  onSend: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export default function Composer({ input, setInput, loading, stopping, onSend, onStop, textareaRef }: ComposerProps) {
  // Dynamic menu loaded from the skills API. Each skill folder adds one slash command.
  const [slashCommands, setSlashCommands] = useState<SlashMenuItem[]>(FALLBACK_SLASH_COMMANDS);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/skills')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.commands) && data.commands.length) {
          setSlashCommands(data.commands);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Ticker picker ────────────────────────────────────────────────────────
  // `/intraday nvx` offers the tickers that match, the same market-aware
  // search the ticker page and Discover use, so the symbol never has to be
  // guessed. Results load a page at a time — nothing is pre-truncated, and
  // indices are no longer filtered out just for starting with `^`.
  const [tickerHighlight, setTickerHighlight] = useState(0);
  // Escape dismisses the picker; typing the next character brings it back.
  const [tickerDismissed, setTickerDismissed] = useState(false);

  const tickerPrompt = useMemo(
    () => parseTickerArgPrompt(input, slashCommands),
    [input, slashCommands],
  );
  const tickerQuery = tickerPrompt?.query ?? '';
  const tickerSearch = useSymbolSearch(tickerQuery, {
    enabled: !!tickerPrompt && !tickerDismissed,
  });
  const tickerResults = tickerSearch.results as TickerResult[];
  const tickerSearching = tickerSearch.isSearching;
  const tickerLoadMoreRef = useLoadMoreOnScroll(
    tickerSearch.hasMore,
    tickerSearch.isSearching || tickerSearch.isLoadingMore,
    tickerSearch.loadMore,
  );

  const pickerOpen =
    !!tickerPrompt &&
    !tickerDismissed &&
    (tickerResults.length > 0 || tickerSearching || tickerQuery.length === 0);

  useEffect(() => {
    if (!tickerPrompt) {
      setTickerHighlight(0);
      return;
    }
    setTickerHighlight(0);
    setTickerDismissed(false);
  }, [tickerPrompt?.cmd, tickerQuery]);

  const selectTicker = (symbol: string) => {
    if (!tickerPrompt) return;
    setInput(tickerPrompt.apply(symbol));
    tickerSearch.reset();
    setTickerDismissed(true);
    // Put the caret after the symbol so the user can keep typing immediately.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && pickerOpen) {
      // Close the picker first; only an open composer with no picker means stop.
      e.preventDefault();
      tickerSearch.reset();
      setTickerDismissed(true);
      return;
    }
    if (pickerOpen && tickerResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTickerHighlight((prev) => Math.min(prev + 1, tickerResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTickerHighlight((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const picked = tickerResults[tickerHighlight];
        if (picked) selectTicker(picked.symbol);
        return;
      }
    }
    if (e.key === 'Escape' && loading) {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading) {
        onSend();
      }
    }
  };

  return (
    <div className={styles['chat-composer']}>
      {input.startsWith('/') && !input.includes(' ') && (
        <div className={styles['chat-slash-menu']} role="listbox" aria-label="Commands">
          {slashCommands
            .filter(c => c.cmd.startsWith(input) || c.title.toLowerCase().startsWith(input.slice(1).toLowerCase()))
            .map(item => (
              <button
                key={item.cmd}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => { setInput(item.cmd); textareaRef.current?.focus(); }}
                className={styles['chat-slash-item']}
              >
                <span className={styles['chat-slash-item-icon']}>
                  <i className={`fa-solid ${item.icon}`}></i>
                </span>
                <span className={styles['chat-slash-item-text']}>
                  <span className={styles['chat-slash-item-title']}>{item.title}</span>
                  <span className={styles['chat-slash-item-desc']}>{item.desc}</span>
                </span>
              </button>
            ))}
        </div>
      )}

      {pickerOpen && (
        <div className={styles['chat-slash-menu']} role="listbox" aria-label="Tickers">
          {!tickerQuery ? (
            <div className={styles['chat-slash-hint']}>
              {tickerSearching ? 'Searching…' : `Type a ticker or company name — ↑ ↓ to browse, Enter to pick.`}
            </div>
          ) : tickerResults.length === 0 ? (
            <div className={styles['chat-slash-hint']}>
              {tickerSearching ? 'Searching…' : `No ticker matches “${tickerQuery}”.`}
            </div>
          ) : (
            <>
              {tickerResults.map((result, idx) => (
                <button
                  key={`${result.symbol}-${result.exchange ?? ''}`}
                  type="button"
                  role="option"
                  aria-selected={idx === tickerHighlight}
                  onMouseEnter={() => setTickerHighlight(idx)}
                  onClick={() => selectTicker(result.symbol)}
                  className={`${styles['chat-slash-item']}${idx === tickerHighlight ? ` ${styles['chat-slash-item-active']}` : ''}`}
                >
                  <span className={styles['chat-slash-item-icon']}>
                    <i className="fa-solid fa-tag"></i>
                  </span>
                  <span className={styles['chat-slash-item-text']}>
                    <span className={styles['chat-slash-item-title']}>{result.symbol}</span>
                    <span className={styles['chat-slash-item-desc']}>
                      {result.name}
                      {result.exchange ? ` · ${result.exchange}` : ''}
                    </span>
                  </span>
                  <span className={styles['chat-slash-item-market']}>
                    {SYMBOL_MARKET_LABEL[(result.market as SymbolMarket) ?? 'other']}
                  </span>
                </button>
              ))}
              <div ref={tickerLoadMoreRef} />
              {tickerSearch.hasMore && (
                <button
                  type="button"
                  className={styles['chat-slash-more']}
                  onClick={tickerSearch.loadMore}
                  disabled={tickerSearch.isLoadingMore}
                >
                  {tickerSearch.isLoadingMore
                    ? 'Loading…'
                    : `Load more · ${tickerResults.length}/${tickerSearch.total}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        className={styles['chat-composer-textarea']}
        placeholder={tickerPrompt ? `Ticker for /${tickerPrompt.cmd} — symbol or company name` : "Write a message or type '/' for commands..."}
        value={input}
        rows={1}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className={styles['chat-composer-footer']}>
        <div className={styles['chat-composer-footer-left']}>
          <button
            type="button"
            className={styles['chat-composer-action-btn']}
            onClick={() => {
              setInput((prev) => (prev ? prev : '/'));
              textareaRef.current?.focus();
            }}
            title="Commands & tools"
            aria-label="Commands"
          >
            <i className="fa-solid fa-plus" style={{ fontSize: '12px' }}></i>
          </button>
        </div>

        <div className={styles['chat-composer-footer-right']}>
          <ChatEffortPicker />
          <ChatRiskPicker />
          <ChatModelPicker />
          <button
            type="button"
            className={`${styles['chat-composer-send-btn']} ${loading ? 'active is-stop' : input.trim() ? 'active' : ''}${stopping ? ' is-stopping' : ''}`}
            onClick={() => {
              if (loading) {
                onStop();
              } else {
                onSend();
              }
            }}
            disabled={!loading && !input.trim()}
            title={loading ? (stopping ? 'Stopping…' : 'Stop generation (Esc)') : 'Send message (Enter)'}
            aria-label={loading ? (stopping ? 'Stopping generation' : 'Stop generation') : 'Send message'}
            aria-busy={loading}
          >
            {loading ? (
              <i className={stopping ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-stop'} style={{ fontSize: '12px' }}></i>
            ) : (
              <i className="fa-solid fa-arrow-up" style={{ fontSize: '13px' }}></i>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
