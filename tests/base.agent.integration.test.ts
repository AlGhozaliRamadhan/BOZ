import { describe, it, expect } from 'vitest';
import { BaseAgent, ParsedToolCall } from '../src/agents/base.agent.js';
import type { LLMMessage } from '../src/types/llm.types.js';

class FakeAdapter {
  private readonly responses: LLMMessage[];

  constructor(responses: LLMMessage[]) {
    this.responses = [...responses];
  }

  async callWithTools(): Promise<LLMMessage> {
    const next = this.responses.shift();
    if (!next) throw new Error('No more responses');
    return next;
  }

  async callText(): Promise<string> {
    return 'ok';
  }
}

class TestAgent extends BaseAgent {
  protected buildSystemPrompt(): string {
    return 'system';
  }

  protected buildInitialPrompt(): string {
    return 'start';
  }

  protected getToolDefinitions(): object[] {
    return [
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'Echo a message',
          parameters: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'finish',
          description: 'Finish the session',
          parameters: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: [],
          },
        },
      },
    ];
  }

  protected async executeTool(call: ParsedToolCall, state: any): Promise<string> {
    if (call.name === 'echo') {
      state.messages.push(call.arguments.message);
      return `echo:${call.arguments.message}`;
    }
    if (call.name === 'finish') {
      state.finished = true;
      return 'done';
    }
    return 'unknown';
  }

  public async runForTest(state: any): Promise<{ messages: LLMMessage[] }> {
    const result = await this.runLoop(
      state,
      (s) => s.finished,
      (args, s) => {
        s.finished = true;
        s.summary = args.summary;
      },
      'TEST',
    );
    return { messages: result.messages };
  }
}

describe('BaseAgent.runLoop integration', () => {
  it('executes tool calls and handles finish', async () => {
    const responses: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: '1', type: 'function', function: { name: 'echo', arguments: '{"message":"hello"}' } },
        ],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: '2', type: 'function', function: { name: 'finish', arguments: '{"summary":"done"}' } },
        ],
      },
    ];

    const agent = new TestAgent(new FakeAdapter(responses) as any);
    const state = { finished: false, messages: [] as string[], summary: '' };

    const { messages } = await agent.runForTest(state);

    expect(state.finished).toBe(true);
    expect(state.messages).toEqual(['hello']);
    expect(state.summary).toBe('done');
    expect(messages.filter(m => m.role === 'tool').length).toBe(2);
  });
});
