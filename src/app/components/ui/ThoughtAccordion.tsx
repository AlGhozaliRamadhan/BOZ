'use client';

import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

export interface ThoughtAccordionProps {
  /**
   * Single thought string, or array of thought strings/steps
   */
  thoughts?: string[] | string;
  /**
   * Optional standalone thought string (alias for thoughts as string)
   */
  thought?: string;
  /**
   * Title shown in header (e.g. "AI Thinking Process", "AI Reasoning Chain")
   * Long marketing titles are shortened automatically.
   */
  title?: string;
  /**
   * Optional duration string or number in seconds (e.g. "2.4s" or 2.4)
   */
  duration?: string | number;
  /**
   * Model or provider name (e.g. "DeepSeek R1", "GPT-4o", "Claude 3.7", "Nemotron")
   */
  modelName?: string;
  /**
   * Whether the AI is currently streaming / generating thoughts
   */
  isStreaming?: boolean;
  /**
   * Whether the accordion starts expanded (defaults to false for finished, true for streaming)
   */
  defaultOpen?: boolean;
  /**
   * Accent style: 'default' | 'cyan' | 'bull' | 'bear' | 'violet'
   */
  accent?: 'default' | 'cyan' | 'bull' | 'bear' | 'violet';
  /**
   * Optional custom CSS class
   */
  className?: string;
  /**
   * Optional custom styling
   */
  style?: React.CSSProperties;
}

const LABEL_OVERRIDES: Record<string, string> = {
  'AI Thinking Process': 'Thought process',
  'Live AI Thinking Process': 'Thought process',
  'Intraday AI Reasoning Process': 'Intraday reasoning',
  'Intraday AI Deep Reasoning Process': 'Intraday reasoning',
  'Long-Term Fundamental Thesis & Reasoning': 'Long-term thesis',
  'Long-Term AI Fundamental Thesis & Thought Process': 'Long-term thesis',
  'News Intel AI Synthesis & Macro Deductions': 'News synthesis',
  'News Intelligence AI Synthesis & Macro Deductions': 'News synthesis',
  'IDX Scanner AI Momentum Deductions & Breadth Analysis': 'Scanner analysis',
};

function shortTitle(t: string): string {
  if (LABEL_OVERRIDES[t]) return LABEL_OVERRIDES[t];
  if (/^Market AI Reasoning/i.test(t)) return 'Market analysis';
  if (t.length > 28) return t.slice(0, 28).trimEnd() + '…';
  return t;
}

export function ThoughtAccordion({
  thoughts,
  thought,
  title,
  duration,
  modelName,
  isStreaming = false,
  defaultOpen,
  accent = 'default',
  className = '',
  style = {},
}: ThoughtAccordionProps) {
  // Normalize thoughts into array of non-empty strings
  const rawList: string[] = [];
  if (Array.isArray(thoughts)) {
    thoughts.forEach((t) => {
      if (typeof t === 'string' && t.trim()) rawList.push(t.trim());
      else if (t && typeof t === 'object') rawList.push(JSON.stringify(t, null, 2));
    });
  } else if (typeof thoughts === 'string' && thoughts.trim()) {
    rawList.push(thoughts.trim());
  }

  if (typeof thought === 'string' && thought.trim() && !rawList.includes(thought.trim())) {
    rawList.unshift(thought.trim());
  }

  const hasThoughts = rawList.length > 0 || isStreaming;
  const initialOpen = defaultOpen !== undefined ? defaultOpen : isStreaming;

  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isRawView, setIsRawView] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-open if streaming starts and user hasn't explicitly set defaultOpen
  useEffect(() => {
    if (isStreaming && defaultOpen === undefined) {
      setIsOpen(true);
    }
  }, [isStreaming, defaultOpen]);

  // Track whether the user is scrolled near the bottom. Auto-scroll only while
  // they're already at the bottom — if they scroll up to read an earlier step,
  // stop yanking them back to the newest.
  const stickToBottom = useRef(true);

  // Auto-scroll when streaming inside open accordion, but only if the user
  // hasn't scrolled away from the bottom.
  useEffect(() => {
    if (isStreaming && isOpen && contentRef.current) {
      if (stickToBottom.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }
  }, [isStreaming, isOpen, rawList]);

  // Detect scroll-away so we stop auto-following while the user reads up top.
  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 60;
  };

  if (!hasThoughts) return null;

  const combinedText = rawList.join('\n\n');

  const formatThoughtHtml = (content: string): string => {
    try {
      const rawHtml = marked.parse(content, { breaks: true, async: false }) as string;
      return DOMPurify.sanitize(rawHtml);
    } catch {
      return DOMPurify.sanitize(content);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(combinedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy thought text', err);
    }
  };

  const toggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  const formattedDuration =
    typeof duration === 'number'
      ? `${duration.toFixed(1)}s`
      : typeof duration === 'string' && duration.trim()
        ? duration.trim()
        : null;

  const stepCount = rawList.length;

  // Prefer short defaults over long marketing titles from call sites
  const label = isStreaming
    ? 'Thinking…'
    : title
      ? shortTitle(title)
      : formattedDuration
        ? `Thought for ${formattedDuration}`
        : 'Thought process';

  // Show duration chip only when label is a short title (not already "Thought for Xs")
  const showDurationChip = !isStreaming && !!formattedDuration && !!title;

  const metaParts: string[] = [];
  if (modelName) metaParts.push(modelName);
  if (stepCount > 1) metaParts.push(`${stepCount} steps`);

  return (
    <div
      className={`thought-accordion ${isOpen ? 'is-open' : 'is-closed'} ${isStreaming ? 'is-streaming' : ''} accent-${accent} ${className}`}
      style={style}
    >
      {/* Header row */}
      <div
        className={`thought-header ${isOpen ? 'is-open' : ''}`}
        onClick={toggleOpen}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleOpen();
          }
        }}
      >
        <div className="thought-row-main">
          {isStreaming ? (
            <svg
              className="spinner-spin thought-spinner"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
          ) : (
            <svg
              className={`thought-chevron ${isOpen ? 'is-open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}

          <span className="thought-label">{label}</span>

          {showDurationChip && (
            <span className="thought-duration">{formattedDuration}</span>
          )}

          <span className={`thought-dot accent-${accent}`} aria-hidden="true" />
        </div>

        <div className="thought-actions" onClick={(e) => e.stopPropagation()}>
          {isOpen && combinedText.length > 0 && (
            <button
              type="button"
              className="thought-action-btn"
              onClick={() => setIsRawView((prev) => !prev)}
              title={isRawView ? 'Switch to Formatted Markdown' : 'Switch to Raw Text'}
            >
              {isRawView ? 'RAW' : 'MD'}
            </button>
          )}

          {combinedText.length > 0 && (
            <button
              type="button"
              className={`thought-action-btn ${copied ? 'is-copied' : ''}`}
              onClick={handleCopy}
              title="Copy thought process to clipboard"
              aria-label={copied ? 'Copied' : 'Copy thought process'}
            >
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expandable body */}
      {isOpen && (
        <div ref={contentRef} className="thought-content-area" onScroll={handleScroll}>
          {isRawView ? (
            <pre className="thought-raw">{combinedText}</pre>
          ) : (
            <div className="thought-formatted-body">
              {rawList.map((stepText, idx) => (
                <div key={idx} className="thought-step-item">
                  {rawList.length > 1 && (
                    <div className="thought-step-label">Step {idx + 1}</div>
                  )}
                  <div
                    className="thought-markdown-text"
                    dangerouslySetInnerHTML={{ __html: formatThoughtHtml(stepText) }}
                  />
                </div>
              ))}

              {isStreaming && <span className="thought-cursor" aria-hidden="true" />}
            </div>
          )}

          {metaParts.length > 0 && (
            <div className="thought-meta">{metaParts.join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ThoughtAccordion;
