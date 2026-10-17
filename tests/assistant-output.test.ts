import { describe, expect, it } from 'vitest';
import {
  extractPrivateReasoning,
  parseAnalysisPassOutput,
  PrivateReasoningStreamFilter,
  sanitizeAssistantOutput,
  summarizeAnalysisActivity,
} from '../src/shared/assistant-output.js';

describe('extractPrivateReasoning', () => {
  // Reads the working out of ONE complete response, for the tool-calling turn
  // where the adapter drops `content` — the reason a model could call a tool
  // with its explanation discarded instead of shown.
  it('returns the block and nothing else', () => {
    expect(extractPrivateReasoning('<thinking>settle whether NVDA is extended</thinking>')).toBe(
      'settle whether NVDA is extended',
    );
    expect(extractPrivateReasoning('<thinking>intent</thinking>Answer text.')).toBe('intent');
    expect(extractPrivateReasoning('Just an answer.')).toBe('');
    expect(extractPrivateReasoning('')).toBe('');
  });

  it('keeps a truncated block instead of losing it', () => {
    // A cut-off turn is exactly when the working is most worth reading.
    expect(extractPrivateReasoning('<thinking>started but never closed')).toBe(
      'started but never closed',
    );
  });
});

describe('sanitizeAssistantOutput', () => {
  it('removes complete and truncated private reasoning blocks', () => {
    expect(sanitizeAssistantOutput('<think>secret scratchpad</think>## Current view\nWait.'))
      .toBe('## Current view\nWait.');
    expect(sanitizeAssistantOutput('<thinking>secret scratchpad'))
      .toBe('');
  });

  it('handles an orphaned closing tag from an assistant prefill', () => {
    expect(sanitizeAssistantOutput('secret scratchpad</think>## Current view\nBuy only above 100.'))
      .toBe('## Current view\nBuy only above 100.');
  });

  it('never lets reasoning reach the answer when tags are split across chunks', () => {
    // The contract CHANGED deliberately: reasoning used to be discarded, and
    // BOZ filled the panel with its own canned sentences instead. It is now
    // extracted and SHOWN. What must never change is the guarantee that no part
    // of a reasoning block can end up in `publicText`.
    const filter = new PrivateReasoningStreamFilter();

    const first = filter.push('Public finding. <thi');
    expect(first.publicText).toBe('Public finding. ');
    expect(first.reasoning).toBe('');

    const second = filter.push('nk>private scratchpad');
    expect(second.publicText).toBe('');
    expect(second.reasoning).toBe('private scratchpad');

    const third = filter.push(' that must not appear</think>Action: wait for confirmation.');
    expect(third.publicText).toBe('Action: wait for confirmation.');
    expect(third.reasoning).toBe(' that must not appear');

    expect(filter.finish()).toEqual({ publicText: '', reasoning: '' });
  });

  it('routes an orphaned or truncated block to reasoning, never to the answer', () => {
    const orphaned = new PrivateReasoningStreamFilter();
    const orphanResult = orphaned.push('private prefill</THINK>Public conclusion.');
    expect(orphanResult.publicText).toBe('Public conclusion.');
    expect(orphanResult.reasoning).toBe('private prefill');

    const truncated = new PrivateReasoningStreamFilter();
    const partial = truncated.push('Visible start <thought>private');
    expect(partial.publicText).toBe('Visible start ');
    // Flushed as soon as it can no longer be the start of a tag, so nothing is
    // held back waiting for a close that never arrives.
    expect(partial.reasoning).toBe('private');
    expect(truncated.finish()).toEqual({ publicText: '', reasoning: '' });
  });

  it('shows reasoning from a block the stream cut off mid-tag', () => {
    // The tag itself is split across chunks, so nothing is known yet. Once the
    // stream ends without a close, the withheld suffix goes to reasoning —
    // dropping it is exactly what used to leave the panel empty.
    const filter = new PrivateReasoningStreamFilter();
    const held = filter.push('Visible start <thou');
    expect(held.publicText).toBe('Visible start ');
    expect(held.reasoning).toBe('');
    expect(filter.finish()).toEqual({ publicText: '', reasoning: '<thou' });
  });

  it('removes generic output announcements', () => {
    expect(sanitizeAssistantOutput("Okay, here's the output: **Wait for confirmation.**"))
      .toBe('**Wait for confirmation.**');
  });

  it('drops prompt-planning prose before the real answer', () => {
    expect(sanitizeAssistantOutput("We need to follow the instruction and craft this.\n## Current view\nAvoid for now."))
      .toBe('## Current view\nAvoid for now.');
  });

  it('turns an unstructured pass draft into a substantial fallback analysis', () => {
    const summary = summarizeAnalysisActivity(
      '## NVDA setup\n**Price is holding above the 20-day average, but volume is still weak.**\n- Entry becomes attractive above $220 with stronger volume.\n- More details that should not be needed.',
      'Bull case',
    );

    expect(summary).toContain('**Bull case**');
    expect(summary).toContain('Price is holding above the 20-day average');
    expect(summary).toContain('Entry becomes attractive above $220');
  });

  it('separates a detailed public analysis note from the concise answer', () => {    const result = parseAnalysisPassOutput(
      `<analysis_note>
Hourly price action rejected $215.10 and recovered to $216.94, showing buyers responded near support even though the session remains choppy.

Price is below the $219 SMA20 but above the $208.79 SMA50. That keeps the immediate signal mixed while preserving the longer trend.

Volume is light, so a long needs confirmation above $219. A stop near $210-$211 allows roughly one ATR of room, with $229.18 and $236.54 as the first two resistance targets.
</analysis_note>
<answer>Consider NVDA only after a volume-backed break above $219, using $210-$211 as the stop area and $229.18 then $236.54 as targets.</answer>`,
      'Evidence brief',
    );

    expect(result.analysis).toContain('**Evidence brief**');
    expect(result.analysis).toContain('rejected $215.10');
    expect(result.analysis).toContain('below the $219 SMA20');
    expect(result.analysis).toContain('Volume is light');
    expect(result.answer).toBe('Consider NVDA only after a volume-backed break above $219, using $210-$211 as the stop area and $229.18 then $236.54 as targets.');
    expect(result.answer).not.toContain('analysis_note');
  });
});
