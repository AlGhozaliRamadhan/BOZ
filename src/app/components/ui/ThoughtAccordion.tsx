'use client';

import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import styles from './ThoughtAccordion.module.css';
import type { ToolResult } from '@/shared/chat-tool-results';
import { parseWebSources, type WebSourceDetail } from '@/shared/tool-result-details';

export interface ThoughtTimelineStep {
  id?: string;
  type: 'thought' | 'tool' | 'search';
  title?: string;
  content: string;
  toolName?: string;
  args?: Record<string, unknown>;
  preview?: string;
  detail?: string;
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
  /** Tool outputs matched to timeline entries, available through Show more. */
  toolResults?: ToolResult[];
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
  toolResults,
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
    const unclaimedToolResults = [...(toolResults ?? [])];
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
        const toolName = parts[0]?.trim();
        const toolId = toolName?.split(/\s+\(/, 1)[0];
        const resultIndex = unclaimedToolResults.findIndex((result) => result.tool === toolId);
        const result = resultIndex >= 0 ? unclaimedToolResults.splice(resultIndex, 1)[0] : undefined;
        steps.push({
          type: 'tool',
          toolName,
          content: raw,
          preview: parts[1]?.trim(),
          detail: result?.detail || result?.preview,
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
      className={`${styles['thought-accordion']} ${isOpen ? 'is-open' : 'is-closed'} ${isStreaming ? 'is-streaming' : ''} accent-${accent} ${className}`}
      style={style}
    >
      {/* Header row */}
      <div
        className={`${styles['thought-header']} ${isOpen ? 'is-open' : ''}`}
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
        <div className={styles['thought-row-main']}>
          {isStreaming ? (
            <span className="spinner spinner-xs" aria-hidden="true" style={{ flexShrink: 0 }} />
          ) : (
            <svg
              className={`${styles['thought-chevron']} ${isOpen ? 'is-open' : ''}`}
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

          <span className={styles['thought-label']}>{label}</span>

          {!isStreaming && stepCount > 1 && (
            <span className={styles['thought-step-badge']}>{stepCount} steps</span>
          )}

          {!isStreaming && formattedDuration && (
            <span className={styles['thought-duration']}>{formattedDuration}</span>
          )}
        </div>

        <div className={styles['thought-actions']} onClick={(e) => e.stopPropagation()}>
          {combinedText.length > 0 && (
            <button
              type="button"
              className={`${styles['thought-action-btn']} ${copied ? 'is-copied' : ''}`}
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
        <div ref={contentRef} className={styles['thought-content-area']} onScroll={handleScroll}>
          <div className={styles['thought-timeline-track']}>
            {steps.map((step, idx) => (
              <div
                key={`${step.type}-${step.toolName ?? step.title ?? 'thought'}-${idx}`}
                className={`${styles['thought-timeline-item']} type-${step.type} ${step.status === 'running' ? 'is-running' : ''}`}
              >
                <div className={styles['thought-timeline-node']}>
                  {step.type === 'tool' || step.type === 'search' ? (
                    <span className={styles['thought-node-dot']}>•</span>
                  ) : (
                    <svg className={styles['thought-node-clock']} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  )}
                </div>

                <div className={styles['thought-timeline-content']}>
                  {step.type === 'tool' || step.type === 'search' ? (
                    <div className={styles['thought-tool-block']}>
                      <div className={styles['thought-tool-header']}>
                        <span className={styles['thought-tool-name']}>{step.toolName || step.title || 'tool_call'}</span>
                        {step.status === 'running' && (
                          <span className="thought-tool-spinner" />
                        )}
                      </div>
                      {step.preview && (
                        <ToolTimelinePreview
                          preview={step.preview}
                          detail={step.detail}
                          isWebSearch={step.toolName?.startsWith('web_search') ?? false}
                        />
                      )}
                    </div>
                  ) : (
                    <div
                      className={styles['thought-markdown-text']}
                      dangerouslySetInnerHTML={{ __html: formatThoughtHtml(step.content) }}
                    />
                  )}
                </div>
              </div>
            ))}

            {isStreaming && (
              <div className={`${styles['thought-timeline-item']} is-running`}>
                <div className={styles['thought-timeline-node']}>
                  <span className={styles['thought-timeline-pulse']} />
                </div>
              </div>
            )}
          </div>

          {modelName && (
            <div className={styles['thought-meta']}>{modelName}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ThoughtAccordion;

function ToolTimelinePreview({
  preview,
  detail,
  isWebSearch,
}: {
  preview: string;
  detail?: string;
  isWebSearch: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const fullDetail = detail?.trim() || '';
  const sources = isWebSearch ? parseWebSources(fullDetail || preview) : [];
  const canExpand = fullDetail.length > preview.trim().length;
  const shown = expanded && canExpand ? fullDetail : preview;

  if (sources.length > 0) return <WebSearchSourceList sources={sources} />;

  return (
    <div>
      <div className={styles['thought-tool-preview']}>{shown}</div>
      {canExpand && (
        <button
          type="button"
          className={styles['thought-tool-toggle']}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function WebSearchSourceList({ sources }: { sources: WebSourceDetail[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleSources = showAll ? sources : sources.slice(0, 5);
  const remaining = sources.length - 5;

  return (
    <div className={styles['web-search-source-list']} aria-label="Web search sources">
      {visibleSources.map((source, index) => (
        <WebSearchSource key={source.url ?? source.title + index} source={source} />
      ))}
      {remaining > 0 && (
        <button
          type="button"
          className={`${styles['thought-tool-toggle']} ${styles['web-search-source-toggle']}`}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show less' : `Show ${remaining} more sources`}
        </button>
      )}
    </div>
  );
}

function WebSearchSource({ source }: { source: WebSourceDetail }) {
  const destination = source.url;
  const publisherDomain = domainFromUrl(source.publisherUrl);
  const resultDomain = domainFromUrl(source.url);
  const label = source.publisher || publisherDomain || resultDomain || 'Web source';
  const faviconDomain = publisherDomain || resultDomain;
  const content = (
    <>
      <span className={styles['web-search-source-favicon']} aria-hidden="true">
        {faviconDomain && (
          <img
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(faviconDomain)}&sz=32`}
            alt=""
            width={16}
            height={16}
            referrerPolicy="no-referrer"
            onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
          />
        )}
      </span>
      <span className={styles['web-search-source-copy']}>
        <span className={styles['web-search-source-title']}>{source.title}</span>
        <span className={styles['web-search-source-publisher']}>{label}</span>
      </span>
    </>
  );

  if (!destination) return <div className={`${styles['web-search-source']} is-unlinked`}>{content}</div>;

  return (
    <a
      className={styles['web-search-source']}
      href={destination}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${source.title} from ${label}`}
    >
      {content}
    </a>
  );
}

function domainFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}
