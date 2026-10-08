import { describe, expect, it } from 'vitest';
import {
  THOUGHT_PROMPTS,
  getReasoningPassPrompt,
  type ThoughtEffort,
} from '../src/shared/thought-prompts.js';

describe('private analysis prompts', () => {
  it('never asks a model to emit tagged chain-of-thought', () => {
    const efforts: ThoughtEffort[] = ['Low', 'Medium', 'High', 'Extra', 'Max'];
    for (const effort of efforts) {
      expect(THOUGHT_PROMPTS[effort]).not.toContain('<think>');
      expect(THOUGHT_PROMPTS[effort]).toContain('Do not reveal private reasoning');
      expect(THOUGHT_PROMPTS[effort]).toContain('user-facing answer');
    }
  });

  it('mandates no fixed skeleton: shape follows findings, numbers stay tool-traced', () => {
    const prompt = getReasoningPassPrompt('Max');
    expect(prompt).toContain('Phase 1');
    expect(prompt).toContain('Phase 2');
    expect(prompt).toContain('risk_calc');
    expect(prompt).toContain('levels not validated');
    expect(prompt).toContain('NO third path');
    expect(prompt).toContain('create NO exemption');
    expect(prompt).toContain('silently');
    expect(prompt).toContain('150-250');
    expect(prompt).toContain('ONE answer');
    expect(prompt).toContain('IMMEDIATELY construct the obvious alternative');
    expect(prompt).toContain('never to tool inputs');
    // The delta rule is deleted: no delta vocabulary, no deltas-only contract.
    expect(prompt).not.toContain('delta');
    expect(prompt).not.toContain('deltas ONLY');
    expect(prompt).not.toContain('Breadth');
    // No mandated envelope or fixed section headings. Ban-list sentences
    // ("Never emit X") name the phrase to forbid it — allowed. A mandate
    // or emitted label is not: every line naming a banned label must ban it.
    const bannedLabels = [
      'Number verification',
      'Initial Quantitative Synthesis',
      'Research brief',
      'Quant recheck',
    ];
    for (const label of bannedLabels) {
      const offenders = prompt
        .split('\n')
        .filter((line) => line.includes(label) && !/never emit|never\b.*as headers|do not create|forbidden|one-render|internal-only/i.test(line));
      expect(offenders, `reasoning pass mandates banned label "${label}"`).toHaveLength(0);
    }
    expect(prompt).not.toContain('<analysis_note>');
    expect(prompt).not.toContain('Market read:');
    expect(prompt).not.toContain('Decisive evidence:');
    expect(prompt).not.toContain('Risk & invalidation:');
    expect(prompt).not.toContain('Execution rationale:');
    // No disclaimer loophole: exemption words appear only in the ban sentence.
    expect(prompt).not.toContain('ILLUSTRATIVE');
    expect(prompt).not.toContain('labelled DERIVED');
    expect(prompt).not.toContain('conditional trigger table');
    // Scenario-first: likely-path table + first-person take always present,
    // bare no-trade refusal banned (ban sentence only).
    expect(prompt).toContain('likely-path table');
    expect(prompt).toContain('My take');
    expect(prompt).toContain('I would wait');
    const noTradeLines = prompt.split('\n').filter((line) => /no-trade/i.test(line));
    expect(noTradeLines.length).toBeGreaterThan(0);
    for (const line of noTradeLines) {
      expect(line).toMatch(/never emit|banned/i);
    }
  });
});
