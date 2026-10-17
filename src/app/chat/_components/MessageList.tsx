'use client';

import { useEffect, useState, type RefObject } from 'react';
import { ThoughtAccordion } from '../../components/ui/ThoughtAccordion';
import { formatContent, formatMessageDate } from '../_lib/chat-format';
import type { ChatMessage } from '../_lib/chat-types';
import type { StreamRetryState, ThoughtStep } from '../_lib/chat-stream-manager';
import type { ToolResult } from '@/shared/chat-tool-results';
import styles from './MessageList.module.css';

/**
 * Seconds left in a scheduled retry backoff, or null when there is none.
 *
 * Ticks on a one-second interval but only calls `setState` when the *rendered*
 * number actually changes, so a 10s wait re-renders this component ten times,
 * not three hundred. The remaining time is always derived from an absolute
 * deadline rather than decremented per tick, so a throttled background tab
 * resumes at the right number instead of drifting.
 */
function useRetryCountdown(retry: StreamRetryState | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!retry) {
      setRemaining(null);
      return;
    }
    const read = () => Math.max(0, Math.ceil((retry.until - Date.now()) / 1000));
    setRemaining(read());
    const timer = setInterval(() => {
      const next = read();
      // Identity comparison on the number: no re-render on an unchanged tick.
      setRemaining((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => clearInterval(timer);
  }, [retry]);

  return remaining;
}

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  stopping?: boolean;
  streamingContent: string;
  /** Live thinking stream, in chronological order. */
  streamingSteps: ThoughtStep[];
  toolStatuses: ToolResult[];
  onSendCommand: (command: string) => void;
  endRef: RefObject<HTMLDivElement | null>;
  showRetry?: boolean;
  onRetry?: () => void;
  showContinue?: boolean;
  onContinue?: () => void;
  /** In-flight provider retry, announced by the SSE stream. */
  streamRetry?: StreamRetryState | null;
  /** The model has started producing thinking, even before any text lands. */
  reasoningActive?: boolean;
}

/** Reader-facing wording per failure code. No provider text crosses this line. */
const RETRY_REASONS: Record<string, string> = {
  RATE_LIMIT: 'The model provider is rate-limiting',
  QUOTA: 'The model provider reports no credit',
  SERVER: 'The model provider had a server error',
  TIMEOUT: 'The request timed out',
  TRANSPORT: 'The connection dropped',
  EMPTY_RESPONSE: 'The model returned an empty response',
};

export default function MessageList({
  messages,
  loading,
  stopping,
  streamingContent,
  streamingSteps,
  toolStatuses,
  onSendCommand,
  endRef,
  showRetry,
  onRetry,
  showContinue,
  onContinue,
  streamRetry,
  reasoningActive,
}: MessageListProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [stoppingElapsedSec, setStoppingElapsedSec] = useState(0);
  // An omitted prop and `null` mean the same thing here: no retry in flight.
  const retryRemainingSec = useRetryCountdown(streamRetry ?? null);

  useEffect(() => {
    if (!stopping) {
      setStoppingElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      setStoppingElapsedSec(Math.round((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [stopping]);

  const copyMessage = (text: string, index: number) => {
    try {
      const result = navigator.clipboard.writeText(text);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          // Clipboard denied — leave the copy button unchanged.
        });
      }
    } catch {
      // Clipboard unavailable (permissions, insecure context).
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // While a background generation is live, the persisted trailing placeholder
  // (partial content, status streaming) would double-render with the live
  // bubble. Hide it from the list; the bubble is the source of truth.
  const displayMessages =
    loading && messages.length > 0
      ? (() => {
          const last = messages[messages.length - 1];
          if (last.role === 'assistant' && last.status === 'streaming') {
            return messages.slice(0, -1);
          }
          return messages;
        })()
      : messages;
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <>
      {displayMessages.map((msg, i) => (
        <div
          key={`${msg.role}-${msg.createdAt ?? 'pending'}-${i}`}
          className={`${styles['chat-bubble']} ${msg.role}`}
        >
          {msg.role === 'assistant' ? (
            <div className="flex-row gap-3" style={{ width: '100%' }}>
              <div className={styles['chat-assistant-avatar']} style={{ flexShrink: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              </div>
              <div style={{ width: '100%', paddingTop: '2px' }}>
                {msg.steps && msg.steps.length > 0 && (
                  // One chronological stream: the model's thinking and the
                  // tools it ran, interleaved as they actually happened.
                  <ThoughtAccordion
                    steps={msg.steps}
                    toolResults={msg.tools}
                    title="Thinking"
                    defaultOpen={false}
                  />
                )}
                {msg.content && (
                  <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                )}

                {/* Ticker Typo Clarification Suggestions */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className={styles['chat-suggestion-group']}>
                    <div className={styles['chat-suggestion-label']}>Suggested Tickers:</div>
                    <div className={styles['chat-suggestion-cards']}>
                      {msg.suggestions.map((s, si) => (
                        <button
                          key={`${s.symbol ?? s.command ?? si}-${si}`}
                          type="button"
                          className={styles['chat-suggestion-card']}
                          onClick={() => onSendCommand(s.command || `/intraday ${s.symbol}`)}
                          title={`Run analysis for ${s.symbol}`}
                        >
                          <div className={styles['chat-suggestion-card-main']}>
                            <span className={styles['chat-suggestion-symbol']}>{s.symbol}</span>
                            <span className={styles['chat-suggestion-name']}>{s.name}</span>
                          </div>
                          {s.exchange && <span className={styles['chat-suggestion-exchange']}>{s.exchange}</span>}
                          <i className={`fa-solid fa-arrow-right ${styles['chat-suggestion-arrow']}`}></i>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assistant Message Actions */}
                {msg.content && (
                  <div className={styles['chat-message-footer']}>
                    {/* When this landed. The generation telemetry that used to
                        sit here (estimated tokens, words, duration, tok/s) was
                        numbers about how BOZ ran rather than about the answer,
                        and the estimates were guesses — so the slot now carries
                        the one fact a reader wants about an old answer. */}
                    <div className={styles['chat-message-meta']}>
                      {formatMessageDate(msg.createdAt) && (
                        <span title={new Date(msg.createdAt!).toLocaleString()}>
                          <i className="fa-regular fa-clock"></i>
                          {formatMessageDate(msg.createdAt)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => copyMessage(msg.content, i)}
                      className={styles['chat-copy-btn']}
                      title="Copy response to clipboard"
                    >
                      <i className={copiedIndex === i ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: '11px' }}></i>
                      <span>{copiedIndex === i ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={styles['chat-user-message']}>
              <span>{msg.content}</span>
              {formatMessageDate(msg.createdAt) && (
                <time dateTime={new Date(msg.createdAt!).toISOString()} className={styles['chat-user-time']}>
                  {formatMessageDate(msg.createdAt)}
                </time>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Loading indicator — streaming assistant response */}
      {loading && (
        <div className={`${styles['chat-bubble']} assistant`}>
          <div className="flex-row gap-3" style={{ width: '100%' }}>
            <div className={styles['chat-assistant-avatar']} style={{ flexShrink: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 24, height: 24, objectFit: 'contain' }} />
            </div>
            <div style={{ width: '100%', paddingTop: '2px' }}>
              {(streamingSteps.length > 0) && (
                <ThoughtAccordion
                  steps={streamingSteps}
                  toolResults={toolStatuses}
                  isStreaming={true}
                  defaultOpen={false}
                  title="Thinking"
                />
              )}
              {/* A retry replaces the idle spinner: the answer is not being written, a
                  failed request is being re-sent. */}
              {streamingContent ? (
                <div dangerouslySetInnerHTML={{ __html: formatContent(streamingContent) }} />
              ) : streamingSteps.length > 0 ? null : streamRetry ? null : (
                <div className="flex-row gap-2 items-center" style={{ height: '28px' }}>
                  <span className="spinner spinner-sm"></span>
                  <span className="page-subtitle animate-fadeIn" style={{ margin: 0, transition: 'all 0.3s ease' }}>
                    {/* Once the provider opens its reasoning channel, say so:
                        a pass that reasons silently is otherwise
                        indistinguishable from a stalled request. */}
                    {reasoningActive ? 'Reasoning...' : 'Thinking...'}
                  </span>
                </div>
              )}
              {streamRetry && (
                <div className="page-subtitle" role="status" aria-live="polite" style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="spinner spinner-sm"></span>
                  <span>
                    {RETRY_REASONS[streamRetry.code] ?? 'The model provider failed'} — retrying
                    {retryRemainingSec !== null && retryRemainingSec > 0 ? ` in ${retryRemainingSec}s` : ''}
                    {' '}({Math.min(streamRetry.attempt, streamRetry.allowance)} of {streamRetry.allowance})
                  </span>
                </div>
              )}
              {stopping && (
                <div className="page-subtitle" role="status" aria-live="polite" style={{ margin: '8px 0 0' }}>
                  Stopping{stoppingElapsedSec > 0 ? `… ${stoppingElapsedSec}s` : '…'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recovery affordance — terminal error/interrupt/stop never auto-resumes.
          Continue heals the truncated answer in place; Retry re-answers. */}
      {(showRetry || showContinue) && (
        <div className={`${styles['chat-bubble']} assistant`}>
          <div className="flex-row gap-3" style={{ width: '100%' }}>
            <div style={{ width: '100%' }}>
              <div className="page-subtitle" style={{ margin: '0 0 8px' }}>
                {lastMessage?.status === 'interrupted'
                  ? 'Generation was interrupted (app closed or reloaded). Partial progress is saved.'
                  : lastMessage?.status === 'cancelled'
                    ? 'Generation stopped. Partial progress is saved.'
                    : 'Generation hit an error. Partial progress is saved.'}
              </div>
              <div className="flex-row gap-2" style={{ flexWrap: 'wrap' }}>
                {showContinue && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={onContinue}
                    title="Pick up the answer from exactly where it stopped"
                  >
                    <i className="fa-solid fa-forward-step"></i>
                    <span>Continue where it stopped</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onRetry}
                  title={showContinue ? 'Discard this answer and generate a fresh one' : undefined}
                >
                  <i className="fa-solid fa-rotate-right"></i>
                  <span>Retry generation</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </>
  );
}
