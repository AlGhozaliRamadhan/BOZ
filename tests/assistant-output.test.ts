import { describe, expect, it } from 'vitest';
import {
  parseAnalysisPassOutput,
  sanitizeAssistantOutput,
  summarizeAnalysisActivity,
} from '../src/shared/assistant-output.js';

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

  it('separates a detailed public analysis note from the concise answer', () => {
    const result = parseAnalysisPassOutput(
      `<analysis_note>
Hourly price action rejected $215.10 and recovered to $216.94, showing buyers responded near support even though the session remains choppy.

Price is below the $219 SMA20 but above the $208.79 SMA50. That keeps the immediate signal mixed while preserving the longer trend.

Volume is light, so a long needs confirmation above $219. A stop near $210-$211 allows roughly one ATR of room, with $229.18 and $236.54 as the first two resistance targets.
</analysis_note>
<answer>Consider NVDA only after a volume-backed break above $219, using $210-$211 as the stop area and $229.18 then $236.54 as targets.</answer>`,
      'Market read',
    );

    expect(result.analysis).toContain('**Market read**');
    expect(result.analysis).toContain('rejected $215.10');
    expect(result.analysis).toContain('below the $219 SMA20');
    expect(result.analysis).toContain('Volume is light');
    expect(result.answer).toBe('Consider NVDA only after a volume-backed break above $219, using $210-$211 as the stop area and $229.18 then $236.54 as targets.');
    expect(result.answer).not.toContain('analysis_note');
  });
});
