'use client';

import { useState, type RefObject } from 'react';
import { ThoughtAccordion } from '../../components/ui/ThoughtAccordion';
import { formatContent, formatMessageTime } from '../_lib/chat-format';
import { formatDuration, formatTokensPerSecond } from '../_lib/chat-message-metrics';
import type { ChatMessage } from '../_lib/chat-types';
import type { ToolResult } from '@/shared/chat-tool-results';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  streamingThoughts: string[];
  toolStatuses: ToolResult[];
  onSendCommand: (command: string) => void;
  endRef: RefObject<HTMLDivElement | null>;
}

export default function MessageList({
  messages,
  loading,
  streamingContent,
  streamingThoughts,
  toolStatuses,
  onSendCommand,
  endRef,
}: MessageListProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <>
      {messages.map((msg, i) => (
        <div key={i} className={`${styles['chat-bubble']} ${msg.role}`}>
          {msg.role === 'assistant' ? (
            <div className="flex-row gap-3" style={{ width: '100%' }}>
              <div className={styles['chat-assistant-avatar']} style={{ flexShrink: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              </div>
              <div style={{ width: '100%', paddingTop: '2px' }}>
                {msg.thoughts && msg.thoughts.length > 0 && (
                  <ThoughtAccordion
                    thoughts={msg.thoughts}
                    toolResults={msg.tools}
                    title="Thought process"
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
                          key={si}
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
                    <div className={styles['chat-message-meta']}>
                      {formatMessageTime(msg.createdAt) && (
                        <span title={new Date(msg.createdAt!).toLocaleString()}>
                          <i className="fa-regular fa-clock"></i>
                          {formatMessageTime(msg.createdAt)}
                        </span>
                      )}
                      {msg.metrics && (
                        <>
                          <span title="Estimated visible output tokens; exact provider usage is not available for every model.">
                            ~{msg.metrics.outputTokensEstimate} tokens
                          </span>
                          <span>{msg.metrics.outputWords} words</span>
                          <span title="Total time from sending the prompt until the reply completed.">
                            {formatDuration(msg.metrics.totalDurationMs)} total
                          </span>
                          {msg.metrics.timeToFirstTokenMs !== undefined && (
                            <span title="Time from sending the prompt until the first visible response token.">
                              first {formatDuration(msg.metrics.timeToFirstTokenMs)}
                            </span>
                          )}
                          {formatTokensPerSecond(msg.metrics.outputTokensPerSecond) && (
                            <span title="Estimated visible output tokens per second after the first visible token.">
                              {formatTokensPerSecond(msg.metrics.outputTokensPerSecond)}
                            </span>
                          )}
                          {msg.metrics.toolCount > 0 && (
                            <span>{msg.metrics.toolCount} tool{msg.metrics.toolCount === 1 ? '' : 's'}</span>
                          )}
                        </>
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
              {formatMessageTime(msg.createdAt) && (
                <time dateTime={new Date(msg.createdAt!).toISOString()} className={styles['chat-user-time']}>
                  Sent {formatMessageTime(msg.createdAt)}
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
              {streamingThoughts.length > 0 && (
                <ThoughtAccordion
                  thoughts={streamingThoughts}
                  toolResults={toolStatuses}
                  isStreaming={true}
                  defaultOpen={false}
                  title="Thought process"
                />
              )}
              {streamingContent ? (
                <div dangerouslySetInnerHTML={{ __html: formatContent(streamingContent) }} />
              ) : streamingThoughts.length > 0 ? null : (
                <div className="flex-row gap-2 items-center" style={{ height: '28px' }}>
                  <span className="spinner spinner-sm"></span>
                  <span className="page-subtitle animate-fadeIn" style={{ margin: 0, transition: 'all 0.3s ease' }}>
                    Thinking...
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </>
  );
}
