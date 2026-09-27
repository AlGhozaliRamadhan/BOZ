import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebChatEngine } from '../src/app/api/chat/chat.engine';
import type { RawToolCall } from '../src/types/llm.types';

vi.mock('../src/services/memory.service', () => ({ memoryService: { getMemory: () => ({ preferences: [], facts: [] }) } }));
afterEach(() => vi.restoreAllMocks());

function tool(name = 'fetch_price', args: object = { symbol_or_name: 'NVDA' }, id = 't1'): RawToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function setup(content: string | null = '<analysis_note>I’ll compare trend strength with the catalyst calendar before choosing an approach.</analysis_note>', calls = [tool()]) {
  const engine = new WebChatEngine();
  const internals = engine as any;
  const model = vi.spyOn(internals, 'callWithFallback')
    .mockResolvedValueOnce({ role: 'assistant', content, tool_calls: calls })
    .mockResolvedValue({ role: 'assistant', content: 'Ready.' });
  const execute = vi.spyOn(internals, 'executeTool').mockResolvedValue('Symbol: NVDA | Price: 100 | Change: 0%');
  const opening = vi.spyOn(internals.llm, 'callText').mockResolvedValue('<analysis_note>The holding period favors checking trend durability first.</analysis_note>');
  vi.spyOn(internals, 'streamThinkingPass').mockImplementation(async function* () {
    yield { type: 'token', data: '<analysis_note>The available evidence favors a conditional approach.</analysis_note><answer>Use the confirmed trigger.</answer>' };
  });
  return { engine, internals, model, execute, opening };
}

describe('public analysis and research recovery', () => {
  it('emits the public approach before any research and a natural update after it', async () => {
    const { engine, opening } = setup();
    const events = await Array.fromAsync(engine.run({ message: 'Analyze NVDA', effort: 'Low' }));
    expect(events[0].type).toBe('thought_new');
    expect(events[1].type).toBe('tool_start');
    const notes = events.filter(event => event.type === 'thought_new').map(event => event.data);
    expect(notes).toHaveLength(2);
    expect(notes.join(' ')).not.toContain('Initial Quantitative');
    expect(opening).not.toHaveBeenCalled();
  });

  it('generates one budgeted opening when the provider omits it', async () => {
    const { engine, internals, opening } = setup(null);
    const events = await Array.fromAsync(engine.run({ message: 'Analyze NVDA', effort: 'Low', model: 'chosen' }));
    expect(events[0].data).toContain('holding period');
    expect(opening).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'chosen', maxTokens: 350 }));
    expect(internals.llmCalls).toBe(1); // Tool and synthesis calls are mocked here.
  });

  it('continues research without fabricated commentary when the opening provider fails', async () => {
    const { engine, opening, execute } = setup(null);
    opening.mockRejectedValue(new Error('provider unavailable'));
    const events = await Array.fromAsync(engine.run({ message: 'Analyze NVDA', effort: 'Low' }));
    expect(events[0].type).toBe('tool_start');
    expect(execute).toHaveBeenCalledOnce();
    expect(events.at(-1)?.type).toBe('done');
  });

  it('skips notes and the opening call when thinking is disabled', async () => {
    const { engine, opening } = setup(null);
    const events = await Array.fromAsync(engine.run({ message: 'Analyze NVDA', thinking: false }));
    expect(opening).not.toHaveBeenCalled();
    expect(events.some(event => event.type === 'thought_new')).toBe(false);
  });

  it('does not add opening calls to direct conversation or clarification', async () => {
    const { engine, opening, model } = setup();
    model.mockReset().mockResolvedValue({ role: 'assistant', content: 'Hello.' });
    await Array.fromAsync(engine.run({ message: 'Hello' }));
    expect(opening).not.toHaveBeenCalled();
    const events = await Array.fromAsync(engine.run({ message: 'find some stocks' }));
    expect(events.map(event => event.type)).toEqual(['token', 'follow_up', 'done']);
    expect(opening).not.toHaveBeenCalled();
  });

  it('retries a failure once and excludes recovered failures from every analysis context', async () => {
    const { engine, execute, internals } = setup();
    execute.mockReset().mockResolvedValueOnce('Tool execution failed: timeout').mockResolvedValueOnce('Price: 100 | Change: 0%');
    const events = await Array.fromAsync(engine.run({ message: 'Analyze NVDA', effort: 'Low' }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event.type === 'tool_result').map(event => event.data.success)).toEqual([false, true]);
    expect(internals.researchContext()).not.toContain('timeout');
    expect(events.filter(event => event.type === 'token').map(event => event.data).join('')).not.toContain('Data availability');
    expect(internals.toolCalls).toBe(2);
  });

  it('does not restart recovery when a failed call is repeated', async () => {
    const { engine, execute, model } = setup();
    execute.mockResolvedValue('Tool execution failed: timeout');
    model.mockReset().mockResolvedValueOnce({ role: 'assistant', tool_calls: [tool()] })
      .mockResolvedValueOnce({ role: 'assistant', tool_calls: [tool()] })
      .mockResolvedValue({ role: 'assistant', content: 'Ready.' });
    const events = await Array.fromAsync(engine.run({ message: 'Analyze NVDA', effort: 'Low' }));
    expect(execute).toHaveBeenCalledTimes(2);
    const answer = events.filter(event => event.type === 'token').map(event => event.data).join('');
    expect(answer.match(/Data availability:/g)).toHaveLength(1);
    expect(answer).toContain('retry or alternative source');
  });

  it('counts automatic ticker research against the same budget and shares its evidence', async () => {
    const { engine, execute, internals } = setup(null, [tool('fetch_ticker_dashboard', { symbol: 'NVDA' })]);
    execute.mockImplementation(async (name) => name === 'web_search' ? '- [News source] A current catalyst. Source: https://example.com' : 'Last Price: $100\nDirectional Bias: BULLISH');
    await Array.fromAsync(engine.run({ message: 'Analyze NVDA', effort: 'Low' }));
    expect(internals.toolCalls).toBe(2);
    expect(internals.researchContext()).toContain('https://example.com');
  });

  it('limits oversized batches, preserves evidence and reaches the answer', async () => {
    const calls = Array.from({ length: 18 }, (_, index) => tool('fetch_price', { symbol_or_name: `STOCK${index}` }, `t${index}`));
    const { engine, execute, internals } = setup(null, calls);
    const events = await Array.fromAsync(engine.run({ message: 'Compare my stocks', effort: 'Low' }));
    expect(execute).toHaveBeenCalledTimes(16);
    expect(internals.toolCalls).toBe(16);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.filter(event => event.type === 'token').map(event => event.data).join('')).toContain('budget');
  });
});
