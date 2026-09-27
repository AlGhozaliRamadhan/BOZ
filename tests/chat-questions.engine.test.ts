import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebChatEngine, detectScreenerMarketFollowUp } from '../src/app/api/chat/chat.engine';
import { createMarketFollowUp, formatFollowUpAnswers } from '../src/shared/chat-follow-up';

vi.mock('../src/services/memory.service', () => ({ memoryService: { getMemory: () => ({ preferences: [], facts: [] }) } }));
afterEach(() => vi.restoreAllMocks());

describe('clarification routing', () => {
  it('asks for a market without running the model or any data tools', async () => {
    const engine = new WebChatEngine();
    const model = vi.spyOn(engine as any, 'callWithFallback');
    const execute = vi.spyOn(engine as any, 'executeTool');
    const events = await Array.fromAsync(engine.run({ message: 'what are good stuff for next month' }));
    expect(events.map(event => event.type)).toEqual(['token', 'follow_up', 'done']);
    expect(events[0].data).toContain('Choose a market');
    expect(events[1].data.followUp).toEqual(createMarketFollowUp());
    expect(model).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses user history but does not mistake assistant options for a chosen market', () => {
    expect(detectScreenerMarketFollowUp('find some stocks', [{ role: 'user', content: 'US stocks please' }])).toBeNull();
    expect(detectScreenerMarketFollowUp('find some stocks', [{ role: 'assistant', content: 'US, IDX, or crypto?' }])).not.toBeNull();
    expect(detectScreenerMarketFollowUp('find us some stocks')).not.toBeNull();
    expect(detectScreenerMarketFollowUp('what is good today')).not.toBeNull();
    expect(detectScreenerMarketFollowUp('What is a screener?')).toBeNull();
    expect(detectScreenerMarketFollowUp('scan Japan next month')).toBeNull();
    expect(detectScreenerMarketFollowUp(formatFollowUpAnswers(createMarketFollowUp(), ['idk, help me choose']))).toBeNull();
  });

  it('pauses a mixed tool batch for a generic question before executing dependent tools', async () => {
    const engine = new WebChatEngine();
    const questions = [{ id: 'ticker', title: 'Which company did you mean?', options: [{ label: 'Apple' }, { label: 'AppLovin' }] }];
    vi.spyOn(engine as any, 'callWithFallback').mockResolvedValue({ role: 'assistant', content: 'Which company?', tool_calls: [
      { id: 'price', function: { name: 'fetch_price', arguments: '{"symbol_or_name":"AAPL"}' } },
      { id: 'ask', function: { name: 'ask_user_questions', arguments: JSON.stringify({ message: 'I can analyze that. First, help me identify the right company.', questions }) } },
    ] });
    const execute = vi.spyOn(engine as any, 'executeTool');
    const events = await Array.fromAsync(engine.run({ message: 'Analyze appl', thinking: false }));
    expect(events.map(event => event.type)).toEqual(['token', 'follow_up', 'done']);
    expect(events[0].data).toBe('I can analyze that. First, help me identify the right company.');
    expect(events[1].data.followUp.questions).toEqual(questions);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns validation feedback so the model can repair malformed questions', async () => {
    const engine = new WebChatEngine();
    const model = vi.spyOn(engine as any, 'callWithFallback')
      .mockResolvedValueOnce({ role: 'assistant', tool_calls: [{ id: 'bad', function: { name: 'ask_user_questions', arguments: '{"questions":[]}' } }] })
      .mockResolvedValueOnce({ role: 'assistant', tool_calls: [{ id: 'good', function: { name: 'ask_user_questions', arguments: JSON.stringify({ questions: createMarketFollowUp().questions }) } }] });
    const events = await Array.fromAsync(engine.run({ message: 'Help me clarify my request', thinking: false }));
    expect(model).toHaveBeenCalledTimes(2);
    expect(events.at(-2)?.type).toBe('follow_up');
    expect(events.at(-1)?.type).toBe('done');
  });
});
