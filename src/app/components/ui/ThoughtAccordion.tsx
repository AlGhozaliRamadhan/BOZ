'use client';

import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

export interface ThoughtTimelineStep {
  id?: string;
  type: 'thought' | 'tool' | 'search';
  title?: string;
  content: string;
  toolName?: string;
  args?: Record<string, unknown>;
  preview?: string;
  status?: 'running' | 'done';
}

export interface ThoughtAccordionProps {
  /**
   * Single thought string, or array of thought strings/steps
   */
  thoughts?: string[] | string;
  /**
   * Optional standalone thought string
   */
  thought?: string;
  /**
   * Optional timeline steps
   */
  timeline?: ThoughtTimelineStep[];
  /**
   * Title shown in header (e.g. "AI analysis")
   */
  title?: string;
  /**
   * Optional duration string or number in seconds
   */
  duration?: string | number;
  /**
   * Model or provider name
   */
  modelName?: string;
  /**
   * Whether the AI is currently streaming / generating thoughts
   */
  isStreaming?: boolean;
  /**
   * Whether the accordion starts expanded
   */
  defaultOpen?: boolean;
  /**
   * Accent style
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
  'AI Thinking Process': 'AI analysis',
  'Live AI Thinking Process': 'AI analysis',
  'Intraday AI Reasoning Process': 'Intraday analysis',
  'Long-Term Fundamental Thesis & Reasoning': 'Long-term analysis',
  'News Intel AI Synthesis & Macro Deductions': 'News analysis',
};

function shortTitle(t: string): string {
  if (LABEL_OVERRIDES[t]) return LABEL_OVERRIDES[t];
  if (/^Market AI Reasoning/i.test(t)) return 'AI analysis';
  if (t.length > 28) return t.slice(0, 28).trimEnd() + '…';
  return t;
}

export function ThoughtAccordion({
  thoughts,
  thought,
  timeline,
  title,
  duration,
  modelName,
  isStreaming = false,
  defaultOpen,
  accent = 'default',
  className = '',
  style = {},
}: ThoughtAccordionProps) {
  // Normalize steps into structured timeline items
  const steps: ThoughtTimelineStep[] = [];

  if (timeline && timeline.length > 0) {
    steps.push(...timeline);
  } else {
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

    rawList.forEach((raw) => {
      if (raw.startsWith('tool used: ') || raw.startsWith('• tool_call: ') || raw.startsWith('Searched: ')) {
        const toolStr = raw.replace(/^tool used:\s*|^• tool_call:\s*|^Searched:\s*/i, '');
        const parts = toolStr.split(' — ');
        steps.push({
          type: 'tool',
          toolName: parts[0]?.trim(),
          content: raw,
          preview: parts[1]?.trim(),
          status: 'done',
        });
      } else {
        steps.push({
          type: 'thought',
          content: raw,
        });
      }
    });
  }

  const hasThoughts = steps.length > 0 || isStreaming;
  const initialOpen = defaultOpen !== undefined ? defaultOpen : false;

  const [isOpen, setIsOpen] = useState(initialOpen);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (isStreaming && isOpen && contentRef.current) {
      if (stickToBottom.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }
  }, [isStreaming, isOpen, steps]);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 60;
  };

  if (!hasThoughts) return null;

  const combinedText = steps.map((s) => s.content).join('\n\n');

  const formatThoughtHtml = (content: string): string => {
    try {
      const rawHtml = marked.parse(content, { breaks: true, async: false });
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

  const stepCount = steps.length;

  const label = isStreaming
    ? 'Thinking...'
    : title
      ? shortTitle(title)
      : formattedDuration
        ? `Thought for ${formattedDuration}`
        : 'Thought process';

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
              width="13"
              height="13"
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
              width="13"
              height="13"
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

          {!isStreaming && stepCount > 1 && (
            <span className="thought-step-badge">{stepCount} steps</span>
          )}

          {!isStreaming && formattedDuration && (
            <span className="thought-duration">{formattedDuration}</span>
          )}
        </div>

        <div className="thought-actions" onClick={(e) => e.stopPropagation()}>
          {combinedText.length > 0 && (
            <button
              type="button"
              className={`thought-action-btn ${copied ? 'is-copied' : ''}`}
              onClick={handleCopy}
              title="Copy analysis activity"
              aria-label={copied ? 'Copied' : 'Copy analysis activity'}
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

      {/* Expandable Timeline Track */}
      {isOpen && (
        <div ref={contentRef} className="thought-content-area" onScroll={handleScroll}>
          <div className="thought-timeline-track">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className={`thought-timeline-item type-${step.type} ${step.status === 'running' ? 'is-running' : ''}`}
              >
                <div className="thought-timeline-node">
                  {step.type === 'tool' || step.type === 'search' ? (
                    <span className="thought-node-dot">•</span>
                  ) : (
                    <svg className="thought-node-clock" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  )}
                </div>

                <div className="thought-timeline-content">
                  {step.type === 'tool' || step.type === 'search' ? (
                    <div className="thought-tool-block">
                      <div className="thought-tool-header">
                        <span className="thought-tool-name">{step.toolName || step.title || 'tool_call'}</span>
                        {step.status === 'running' && (
                          <span className="thought-tool-spinner" />
                        )}
                      </div>
                      {step.preview && (
                        <div className="thought-tool-preview">
                          {step.preview}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="thought-markdown-text"
                      dangerouslySetInnerHTML={{ __html: formatThoughtHtml(step.content) }}
                    />
                  )}
                </div>
              </div>
            ))}

            {isStreaming && (
              <div className="thought-timeline-item is-running">
                <div className="thought-timeline-node">
                  <span className="thought-timeline-pulse" />
                </div>
              </div>
            )}
          </div>

          {modelName && (
            <div className="thought-meta">{modelName}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ThoughtAccordion;
