import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ThoughtAccordion } from '../src/app/components/ui/ThoughtAccordion';
import type { ThoughtStep } from '../src/app/chat/_lib/chat-stream-manager';

// The panel's markup, pinned where it is cheap to pin. Both regressions here
// were invisible in the component source and only showed on screen:
//
//   1. The collapsed one-line preview is a plain inline-flex row sized by its
//      content, so it ran past the bubble and was clipped mid-word with no
//      ellipsis. It must be present while closed and ABSENT while open — while
//      open it is the first line of the block directly below it, so printing it
//      twice reads as duplication.
//   2. The expanded body used to be a 420px scroll box inside a scrolling chat,
//      which made the reasoning read as a framed widget instead of prose. The
//      body must render the reasoning as real text, not as a collapsed stub.

const REASONING =
  'The user asks about IDX stocks that keep going down, a broad scan question. This fits the /scan or /idx lens. Let me load the idx skill first, then pull the momentum list so the read is grounded rather than from memory.';

const REASONING_STEP: ThoughtStep = { kind: 'reasoning', id: 'r1', text: REASONING };

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(ThoughtAccordion, { title: 'Thinking', steps: [REASONING_STEP], ...props }),
  );
}

describe('thinking panel markup', () => {
  it('shows no summary line beside the label, closed or open', () => {
    // The header carried a one-line preview of the reasoning, which was a second
    // place the same sentence appeared and, collapsed, the only place a caller
    // with a bare `reasoning` blob ever showed it.
    const closed = render({ defaultOpen: false });
    expect(closed).not.toContain('thought-preview');
    expect(closed).toContain('Thinking');
  });

  it('renders a caller-supplied reasoning blob in the body', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThoughtAccordion, { title: 'Intraday analysis', reasoning: REASONING, defaultOpen: true }),
    );
    // Not a header summary: the full text, where the reader expands to read.
    expect(html).not.toContain('thought-preview');
    expect(html).toContain('IDX stocks that keep going down');
    expect(html).toContain('thought-markdown-text');
  });

  it('collapses a paragraph the model repeated inside one block', () => {
    // The stream manager merges contiguous reasoning into a single entry, so a
    // self-repeating block arrives as one step and the step-level dedupe cannot
    // see it. Observed verbatim: the same twelve-line plan printed twice.
    const paragraph =
      'The user is asking about IDX stocks that keep going down. This is a broad question, so an IDX momentum scan is the right tool. Let me load the idx skill and run the scan.';
    const block = `${paragraph}\n\nSomething changed after the scan came back.\n\n${paragraph}`;
    const html = renderToStaticMarkup(
      React.createElement(ThoughtAccordion, {
        title: 'Thinking',
        steps: [{ kind: 'reasoning', id: 'r1', text: block }],
        defaultOpen: true,
      }),
    );
    const occurrences = html.split('an IDX momentum scan is the right tool').length - 1;
    expect(occurrences).toBe(1);
    // The material between the repeats is untouched.
    expect(html).toContain('Something changed after the scan came back');
  });

it('shows a block the model said twice only once', () => {
    // A retry re-issues the prompt and a provider can replay the same reasoning
    // block. Two identical entries read as the app stuttering, not as thinking.
    const repeated = [
      REASONING_STEP,
      { kind: 'reasoning', id: 'r2', text: REASONING } as ThoughtStep,
      { kind: 'reasoning', id: 'r3', text: 'The scan returned nothing actionable, so the read is that the tape is simply broken.' } as ThoughtStep,
    ];
    const html = renderToStaticMarkup(
      React.createElement(ThoughtAccordion, { title: 'Thinking', steps: repeated, defaultOpen: true }),
    );
    const occurrences = html.split('IDX stocks that keep going down').length - 1;
    expect(occurrences).toBe(1);
    // The distinct follow-up survives: only the repeat is dropped.
    expect(html).toContain('nothing actionable');
  });

  it('renders the whole reasoning as prose when expanded', () => {
    const open = render({ defaultOpen: true });
    // The full text, not the first line and not a truncation: it is prose now,
    // so the panel has to carry all of it.
    expect(open).toContain('grounded rather than from memory');
    expect(open).toContain('thought-markdown-text');
    // No nested scroll container to hide it behind.
    expect(open).not.toContain('onScroll');
  });

  it('labels nothing and boxes nothing around the reasoning', () => {
    const open = render({ defaultOpen: true });
    // The old frame: a captioned block reading "Thinking — what the model
    // worked through". The reasoning is not an artefact with a caption.
    expect(open).not.toContain('what the model worked through');
    expect(open).not.toContain('thought-reasoning-block');
    expect(open).not.toContain('thought-reasoning-label');
  });

  it('shows the reasoning of a tool-led turn alongside the compact tool row', () => {
    const steps: ThoughtStep[] = [
      REASONING_STEP,
      { kind: 'tool', id: 't1', tool: 'fetch_ticker_dashboard', status: 'done', fact: 'Loaded 6 indices' },
    ];
    const html = renderToStaticMarkup(
      React.createElement(ThoughtAccordion, { title: 'Thinking', steps, defaultOpen: true }),
    );
    expect(html).toContain('fetch_ticker_dashboard');
    expect(html).toContain('Loaded 6 indices');
    // Raw output waits for the click instead of opening by default.
    expect(html).toContain('Show output');
    expect(html).toContain('thought-markdown-text');
  });
});