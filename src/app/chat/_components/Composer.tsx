'use client';

import { useEffect, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';
import ChatEffortPicker from './ChatEffortPicker';
import ChatModelPicker from './ChatModelPicker';
import ChatRiskPicker from './ChatRiskPicker';
import styles from './Composer.module.css';

interface SlashMenuItem {
  cmd: string;
  title: string;
  desc: string;
  icon: string;
}

/** Fallback when the skills API is unreachable. Mirrors the committed BOZ skill frontmatter. */
const FALLBACK_SLASH_COMMANDS: SlashMenuItem[] = [
  { cmd: '/intraday ', title: 'Intraday', desc: 'Live intraday analysis & key levels [ticker]', icon: 'fa-chart-line' },
  { cmd: '/longterm ', title: 'Longterm', desc: 'Fundamental analysis & long-term outlook [ticker]', icon: 'fa-scale-balanced' },
  { cmd: '/newsintel ', title: '/newsintel', desc: 'Scan latest market headlines', icon: 'fa-newspaper' },
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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

      <textarea
        ref={textareaRef}
        className={styles['chat-composer-textarea']}
        placeholder="Write a message or type '/' for commands..."
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
