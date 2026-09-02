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

  it('requests a detailed public analysis note and a separate concise answer', () => {
    const prompt = getReasoningPassPrompt('Max');
    expect(prompt).toContain('Reason silently');
    expect(prompt).toContain('<analysis_note>');
    expect(prompt).toContain('3-5 short paragraphs');
    expect(prompt).toContain('<answer>');
    expect(prompt).toContain('what the user can do');
    expect(prompt).toContain('Do not use a rigid "Verdict" heading');
    expect(prompt).toContain('unless the user explicitly asks');
  });
});
