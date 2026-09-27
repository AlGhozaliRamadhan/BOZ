import { describe, expect, it } from 'vitest';
import { createMarketFollowUp, followUpHistoryContent, formatFollowUpAnswers, getActiveFollowUp, parseChatFollowUp, readMessageFollowUp } from '../src/shared/chat-follow-up';

describe('composer question contract', () => {
  it('validates arbitrary questions and free-text prompts without market-specific fields', () => {
    const followUp = { kind: 'questions', questions: [{ id: 'goal', title: 'What would you like to focus on?', options: [] }] };
    expect(parseChatFollowUp(followUp)).toEqual(followUp);
  });

  it('rejects malformed, duplicate, and unbounded model payloads', () => {
    const market = createMarketFollowUp();
    for (const invalid of [null, {}, { kind: 'questions', questions: [] }, { kind: 'questions', questions: Array(4).fill(market.questions[0]) }, { kind: 'questions', questions: Array(2).fill(market.questions[0]) }, { kind: 'questions', questions: [{ id: 'x', title: 'x', options: [{ label: 1 }] }] }, { kind: 'questions', questions: [{ id: 'x', title: 'x'.repeat(241), options: [] }] }]) {
      expect(parseChatFollowUp(invalid)).toBeNull();
    }
  });

  it('keeps custom answers verbatim without inventing a preset or changing the horizon', () => {
    const custom = 'Japan, next month; oversold only. I am not sure which sector.';
    const result = formatFollowUpAnswers(createMarketFollowUp(), [custom]);
    expect(result).toContain(custom);
    expect(result).not.toContain('rebound');
    expect(() => formatFollowUpAnswers(createMarketFollowUp(), ['   '])).toThrow();
    expect(() => formatFollowUpAnswers(createMarketFollowUp(), ['x'.repeat(2001)])).toThrow();
  });

  it('keeps question context in history and does not resurrect resolved or dismissed questions', () => {
    const message = { role: 'assistant', content: '', followUp: createMarketFollowUp() };
    expect(getActiveFollowUp([message])?.index).toBe(0);
    expect(getActiveFollowUp([message, { role: 'user' }])).toBeNull();
    expect(getActiveFollowUp([message, { role: 'assistant' }])).toBeNull();
    expect(getActiveFollowUp([{ ...message, followUpDismissed: true }])).toBeNull();
    expect(followUpHistoryContent(message)).toContain(message.followUp.questions[0].title);
    expect(followUpHistoryContent({ ...message, followUpDismissed: true })).toContain('dismissed');
  });

  it('upgrades saved market and ticker pickers to composer questions', () => {
    expect(readMessageFollowUp({ followUp: { kind: 'screener-market', preset: 'rebound' } })).toEqual(createMarketFollowUp());
    expect(readMessageFollowUp({ suggestions: [{ symbol: 'NVDA', name: 'NVIDIA', command: '/intraday NVDA' }] })?.questions[0].options).toEqual([{ label: 'NVDA', description: 'NVIDIA' }]);
  });
});
