'use client';

import { type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';
import ChatEffortPicker from './ChatEffortPicker';
import ChatModelPicker from './ChatModelPicker';
import ChatRiskPicker from './ChatRiskPicker';
import styles from './Composer.module.css';

const SLASH_COMMANDS = [
  { cmd: '/intraday ', title: 'Intraday', desc: 'Live intraday analysis & key levels [ticker]', icon: 'fa-chart-line' },
  { cmd: '/longterm ', title: 'Longterm', desc: 'Fundamental analysis & long-term outlook [ticker]', icon: 'fa-scale-balanced' },
  { cmd: '/newsintel', title: '/newsintel', desc: 'Scan latest market headlines', icon: 'fa-newspaper' },
];

interface ComposerProps {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  loading: boolean;
  onSend: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export default function Composer({ input, setInput, loading, onSend, onStop, textareaRef }: ComposerProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading) {
        onSend();
      }
    }
  };

  return (
    <div className={styles['chat-composer']}>
      {input.startsWith('/') && !input.includes(' ') && input !== '/newsintel' && (
        <div className={styles['chat-slash-menu']} role="listbox" aria-label="Commands">
          {SLASH_COMMANDS
            .filter(c => c.cmd.startsWith(input) || c.title.startsWith(input))
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
            className={`${styles['chat-composer-send-btn']} ${loading ? 'active is-stop' : input.trim() ? 'active' : ''}`}
            onClick={() => {
              if (loading) {
                onStop();
              } else {
                onSend();
              }
            }}
            disabled={!loading && !input.trim()}
            title={loading ? 'Stop generation' : 'Send message (Enter)'}
            aria-label={loading ? 'Stop generation' : 'Send message'}
          >
            {loading ? (
              <i className="fa-solid fa-stop" style={{ fontSize: '12px' }}></i>
            ) : (
              <i className="fa-solid fa-arrow-up" style={{ fontSize: '13px' }}></i>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
