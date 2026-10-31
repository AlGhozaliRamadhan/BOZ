'use client';

import React, { useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import styles from './ThoughtAccordion.module.css';
import type { ToolResult } from '@/shared/chat-tool-results';
import type { ThoughtStep } from '@/app/chat/_lib/chat-stream-manager';
import type { ToolLabelPhase } from '@/shared/tool-labels';
import { toolLabel } from '@/shared/tool-labels';
import { parseWebSources, type WebSourceDetail } from '@/shared/tool-result-details';

/**
 * Marks a timeline entry as the model's own thinking rather than a tool call.
 *
 * The renderer branches on `type` alone: a separate "is this thinking" title
 * meant the label a user read and the branch that styled it could drift apart.
 */
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
  /** Transient data-source retry, while the row is still running. */
  retry?: { attempt: number; allowance: number };
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
   * The thinking stream, in the order it happened.
   *
   * Preferred over `thoughts`/`reasoning`: one chronological list renders as a
   * narrative — thought, tool, result, reaction — whereas two separate lists
   * lose the causal order that is the only reason to show a timeline at all.
   */
  steps?: ThoughtStep[];
  /**
   * The model's own reasoning, shown as the FIRST timeline entry.
   *
   * Legacy path for callers that only have a reasoning blob. New callers pass
   * `steps`.
   */
  reasoning?: string;
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
  steps: streamSteps,
  reasoning,
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
  const assembled: ThoughtTimelineStep[] = [];

  // A unified stream is already in order; nothing to derive.
  const unified = streamSteps
    ?.filter((step) => step.kind === 'reasoning' ? step.text.trim().length > 0 : true)
    .map((step): ThoughtTimelineStep => step.kind === 'reasoning'
      ? { id: step.id, type: 'thought', content: step.text }
      : {
          id: step.id,
          type: 'tool',
          title: step.tool,
          content: step.fact ?? '',
          toolName: step.tool,
          args: step.args,
          preview: step.preview,
          detail: step.detail,
          status: step.status,
          retry: step.retry,
        });

  if (unified && unified.length > 0) {
    assembled.push(...unified);
  } else if (timeline && timeline.length > 0) {
    assembled.push(...timeline);
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
        assembled.push({
          type: 'tool',
          toolName,
          // The row already names the tool, so the summary starts after the
          // "tool used:" prefix instead of repeating it.
          content: parts.slice(1).join(' — ').trim(),
          preview: parts[1]?.trim(),
          detail: result?.detail || result?.preview,
          status: 'done',
        });
      } else {
        assembled.push({
          type: 'thought',
          content: raw,
        });
      }
    });
  }

  // A `reasoning` blob from a caller that has no stream (the intraday, long-term
  // and news pages) used to be shown only as the collapsed one-liner in the
  // header, so it was never actually readable anywhere. With that line gone it
  // becomes the first entry of the panel body instead: the same text, in the
  // place the reader actually opens to read.
  const reasoningText = reasoning?.trim() ?? '';
  if (reasoningText && !assembled.some((step) => step.type === 'thought')) {
    assembled.unshift({ type: 'thought', content: reasoningText });
  }

  const steps = dropRepeatedThoughts(assembled);

  const hasThoughts = steps.length > 0 || isStreaming;
  const initialOpen = defaultOpen !== undefined ? defaultOpen : false;

  const [isOpen, setIsOpen] = useState(initialOpen);
  const [copied, setCopied] = useState(false);

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

          {!isOpen && !isStreaming && stepCount > 1 && (
            <span className={styles['thought-step-badge']}>
              {stepCount} step{stepCount === 1 ? '' : 's'}
            </span>
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
        <div className={styles['thought-content-area']}>
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
                  {step.type === 'thought' ? (
                    // Plain prose. No container, no banner, no "what the model
                    // worked through" label: the block IS the thinking, and a
                    // box around it made the reasoning read as a labelled
                    // artefact instead of the thing it is. Markdown is still
                    // rendered (and sanitized) because several legacy callers
                    // hand this component real markdown.
                    <div
                      className={styles['thought-markdown-text']}
                      dangerouslySetInnerHTML={{ __html: formatThoughtHtml(step.content) }}
                    />
                  ) : (
                    <ToolStepRow
                      name={step.toolName || step.title || 'tool_call'}
                      args={step.args}
                      retry={step.retry}
                      summary={step.content}
                      preview={step.preview}
                      detail={step.detail}
                      isRunning={step.status === 'running'}
                      isWebSearch={step.toolName?.startsWith('web_search') ?? false}
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

/**
 * Drop a reasoning block the model already said, word for word.
 *
 * A retry re-issues a prompt, and a provider that replays the same reasoning
 * block produces two identical entries: the reader scrolls past the same
 * paragraph twice and reads it as the app stuttering.
 *
 * Deliberately exact. Near-duplicates are the model's own phrasing drifting
 * between two passes, and quietly deleting a thought BOZ merely judges
 * "similar" is exactly the authorship this component must not do — that text is
 * the model's, not ours. Whitespace is collapsed only so a re-wrapped block is
 * recognised as the same words.
 */
function dropRepeatedThoughts(steps: ThoughtTimelineStep[]): ThoughtTimelineStep[] {
  const seen = new Set<string>();
  const kept: ThoughtTimelineStep[] = [];
  for (const step of steps) {
    if (step.type !== 'thought') {
      kept.push(step);
      continue;
    }
    const key = step.content.replace(/\s+/g, ' ').trim();
    if (!key) {
      kept.push(step);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...step, content: dropRepeatedParagraphs(step.content) });
  }
  return kept;
}

/**
 * Collapse a paragraph the model wrote twice inside ONE block.
 *
 * The stream manager merges contiguous reasoning into a single entry, so a
 * block that repeats itself arrives as one step and the step-level dedupe above
 * cannot see it. Observed verbatim in the panel: the same twelve-line "let me
 * load the idx skill and run a scan" plan printed twice, and the same
 * "the dashboard's own plan fails at R:R 0.33/0.48" paragraph printed twice.
 *
 * Exact paragraph match only, for the same reason as above — a paragraph the
 * model rephrased is a thought, and quietly dropping it is authoring. Split on
 * blank lines because that is the boundary the model itself used when it
 * repeated itself.
 */
function dropRepeatedParagraphs(content: string): string {
  const paragraphs = content.split(/\r?\n(?:[\t ]*\r?\n)+/);
  if (paragraphs.length < 2) return content;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const key = paragraph.replace(/\s+/g, ' ').trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(paragraph);
  }
  return kept.join('\n\n');
}

/** Longest one-line summary shown before the reader asks for the raw output. */
const SUMMARY_LIMIT = 190;

/**
 * First meaningful line of a tool payload, clipped to one row.
 *
 * A tool step is a fact about the run, not the analysis: the panel's job is the
 * reasoning, so a call takes one line and the payload waits behind a click.
 * Without this the thinking was a wall of `<boz_skills>` XML dumps and the
 * model's own words were the smallest thing on screen.
 */
function oneLineSummary(...sources: Array<string | undefined>): string {
  for (const source of sources) {
    const first = (source ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!first) continue;
    return first.length > SUMMARY_LIMIT ? `${first.slice(0, SUMMARY_LIMIT).trimEnd()}…` : first;
  }
  return '';
}

/**
 * One tool call, collapsed by default.
 *
 * The row leads with a human label ("Loading VOO dashboard") that phases with
 * the call and carries the ticker when it can — the wire name survives only as
 * hover text. A transient retry takes over the summary slot while it runs; the
 * fact that came back replaces it once the call settles. Raw output, and the
 * web-source list for a search, render once the reader opens it.
 */
function ToolStepRow({
  name,
  args,
  retry,
  summary,
  preview,
  detail,
  isRunning,
  isWebSearch,
}: {
  name: string;
  args?: Record<string, unknown>;
  retry?: { attempt: number; allowance: number };
  summary?: string;
  preview?: string;
  detail?: string;
  isRunning: boolean;
  isWebSearch: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const headline = oneLineSummary(summary, preview);
  const rawDetail = detail?.trim() ?? '';
  const sources = isWebSearch ? parseWebSources(rawDetail || preview || '') : [];
  const hasRawOutput = sources.length > 0 || rawDetail !== headline;

  const phase: ToolLabelPhase = isRunning ? (retry ? 'retry' : 'running') : 'done';
  const label = toolLabel(name, args, phase);
  const retryNote = isRunning && retry
    ? `${label} (${retry.attempt}/${retry.allowance})…`
    : null;

  return (
    <div className={styles['thought-tool-row']}>
      <button
        type="button"
        className={styles['thought-tool-line']}
        onClick={() => hasRawOutput && setExpanded((value) => !value)}
        aria-expanded={hasRawOutput ? expanded : undefined}
        disabled={!hasRawOutput}
      >
        <span className={styles['thought-tool-name']} title={name}>{label}</span>
        {isRunning && <span className="spinner spinner-xs" aria-hidden="true" />}
        {retryNote ? (
          <span className={styles['thought-tool-retry']}>{retryNote}</span>
        ) : headline ? (
          <span className={styles['thought-tool-summary']}>{headline}</span>
        ) : null}
        {hasRawOutput && (
          <span className={styles['thought-tool-toggle']}>
            {expanded ? 'Hide output' : 'Show output'}
          </span>
        )}
      </button>

      {expanded && hasRawOutput && (
        sources.length > 0 ? (
          <WebSearchSourceList sources={sources} />
        ) : (
          <pre className={styles['thought-tool-output']}>{rawDetail || preview}</pre>
        )
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
