import { describe, expect, it } from 'vitest';
import { LLMAdapter } from '../src/services/ai/llm.adapter.js';
import { config } from '../src/config/config.js';

describe('LLMAdapter.extractJson', () => {
  it('strips code fences', () => {
    const raw = '```json\n{"status":"ok"}\n```';
    const extracted = LLMAdapter.extractJson(raw);
    expect(extracted?.jsonText).toBe('{"status":"ok"}');
    expect(extracted?.warnings.length).toBeGreaterThan(0);
  });

  it('trims non-JSON text around response', () => {
    const raw = 'prefix {"status":"ok"} suffix';
    const extracted = LLMAdapter.extractJson(raw);
    expect(extracted?.jsonText).toBe('{"status":"ok"}');
    expect(extracted?.warnings.length).toBeGreaterThan(0);
  });
});

describe('LLMAdapter toolless turns', () => {
  // A greeting is answered with no tools. Sending `tools: []` is rejected by
  // OpenAI (minimum length 1) and `tool_choice` without `tools` is rejected by
  // Anthropic, so a toolless turn must OMIT both keys rather than empty them.
  // Without this the greeting either fails outright or keeps the toolbox that
  // invited the `list_skills` call the user did not want.

  it('omits tools and tool_choice on an OpenAI-compatible provider', async () => {
    const adapter = new LLMAdapter();
    let sent: Record<string, unknown> | null = null;
    (adapter as any).cloudClient = () => ({
      client: {
        chat: {
          completions: {
            create: async (params: Record<string, unknown>) => {
              sent = params;
              return { choices: [{ message: { content: 'Hey.' } }] };
            },
          },
        },
      },
      model: 'test-model',
    });

    await (adapter as any).callCloudWithTools('openai', {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      temperature: 0.3,
      maxTokens: 64,
      toolChoice: 'auto',
    });

    expect(sent).not.toBeNull();
    expect('tools' in (sent as unknown as object)).toBe(false);
    expect('tool_choice' in (sent as unknown as object)).toBe(false);
    expect((sent as unknown as { model: string }).model).toBe('test-model');
  });

  it('still sends tools when the turn has them', async () => {
    const adapter = new LLMAdapter();
    let sent: Record<string, unknown> | null = null;
    (adapter as any).cloudClient = () => ({
      client: {
        chat: {
          completions: {
            create: async (params: Record<string, unknown>) => {
              sent = params;
              return { choices: [{ message: { content: 'ok' } }] };
            },
          },
        },
      },
      model: 'test-model',
    });

    const tools = [{ type: 'function', function: { name: 'fetch_price' } }];
    await (adapter as any).callCloudWithTools('openai', {
      messages: [{ role: 'user', content: 'price of nvda' }],
      tools,
      temperature: 0.3,
      maxTokens: 64,
      toolChoice: 'auto',
    });

    expect((sent as unknown as { tools: unknown[] }).tools).toEqual(tools);
  });

  it('omits tool_choice for Anthropic when the turn has no tools', async () => {
    const adapter = new LLMAdapter();
    let sent: Record<string, unknown> | null = null;
    (adapter as any).createAnthropicMessage = async (opts: Record<string, unknown>) => {
      sent = opts;
      return { content: [{ type: 'text', text: 'Hey.' }] };
    };

    await (adapter as any).callAnthropicWithTools({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      maxTokens: 64,
      toolChoice: undefined,
    });

    expect(sent).not.toBeNull();
    expect('tool_choice' in (sent as unknown as object)).toBe(false);
    expect((sent as unknown as { tools: unknown[] }).tools).toEqual([]);
  });
});

describe('LLMAdapter reasoning separation', () => {
  // The contract changed deliberately: provider reasoning used to be discarded
  // outright (`thought: null`), which threw away a stream the model had already
  // produced and billed for. It is now captured — onto its OWN field, never
  // concatenated into the answer. These tests pin the separation, which is the
  // property that actually matters.

  it('keeps provider-native reasoning off the answer', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '## Current view\nWait for confirmation.',
      reasoning_content: 'private provider scratchpad',
    });

    expect(message.content).toBe('## Current view\nWait for confirmation.');
    // Never a substring of the visible answer.
    expect(message.content).not.toContain('private provider scratchpad');
    expect(message.thought).toBe('private provider scratchpad');
  });

  it('removes tagged reasoning from normalized content', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '<think>private provider scratchpad</think>## Current view\nAvoid.',
    });

    expect(message.content).toBe('## Current view\nAvoid.');
    expect(message.thought).toBeNull();
  });

  it('leaves reasoning null when the provider sent none', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    expect(normalize({ content: 'plain answer' }).thought).toBeNull();
  });

  it('still nulls content when the turn is a tool call', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: 'ignored',
      reasoning_content: 'weighed the options',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'fetch_price', arguments: '{}' } }],
    });
    expect(message.content).toBeNull();
    expect(message.thought).toBe('weighed the options');
  });

  // A tool turn nulls `content`, so an inline block used to vanish with it and
  // the panel opened on the call with nothing saying why. Scoped to tool turns:
  // with no tool call the block is already out of `content` and is not re-surfaced.
  it('keeps an inline block on a tool turn instead of dropping it with the content', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '<thinking>No ticker named, so check what I can offer.</thinking>',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'list_skills', arguments: '{}' } }],
    });
    expect(message.content).toBeNull();
    expect(message.thought).toBe('No ticker named, so check what I can offer.');
  });

  it('prefers provider-native reasoning over an inline block on a tool turn', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '<thinking>inline copy</thinking>',
      reasoning_content: 'native copy',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'list_skills', arguments: '{}' } }],
    });
    expect(message.thought).toBe('native copy');
  });

  it('leaves thought null on a tool turn that carried no working', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'list_skills', arguments: '{}' } }],
    });
    expect(message.thought).toBeNull();
  });
});

describe('LLMAdapter custom (9router) provider', () => {
  // The model string a router published is the model string it resolves. BOZ
  // used to strip router namespaces ("openrouter/", "ollama/", "cf/@cf/") from
  // every provider's model ID, which the router answered with
  // "invalid model format" — a 400 the user saw as a generation error.
  function withCustomProvider(run: () => Promise<void>): Promise<void> {
    const previousProvider = config.aiProvider;
    const previousModel = config.custom.model;
    config.setAIProvider('custom');
    config.setAIModel('placeholder-model', 'custom');
    return run().finally(() => {
      config.setAIModel(previousModel, 'custom');
      config.setAIProvider(previousProvider);
    });
  }

  function stubClient(create: (params: Record<string, unknown>) => Promise<unknown>) {
    return {
      chat: { completions: { create } },
    };
  }

  it('sends a namespaced model ID verbatim', async () => {
    await withCustomProvider(async () => {
      const adapter = new LLMAdapter();
      let sent: Record<string, unknown> | null = null;
      (adapter as any).customClient = async () => stubClient(async (params) => {
        sent = params;
        return { choices: [{ message: { content: 'ok' } }] };
      });

      await adapter.callWithTools({
        messages: [{ role: 'user', content: 'price of nvda' }],
        tools: [{ type: 'function', function: { name: 'fetch_price' } }],
        model: 'openrouter/vendor/some-model',
      });

      expect((sent as unknown as { model: string }).model).toBe('openrouter/vendor/some-model');
    });
  });

  it('retries toolless when the router rejects the tool payload', async () => {
    await withCustomProvider(async () => {
      const adapter = new LLMAdapter();
      const sent: Record<string, unknown>[] = [];
      (adapter as any).customClient = async () => stubClient(async (params) => {
        sent.push(params);
        if (sent.length === 1) {
          throw Object.assign(new Error('this model does not support tools'), { status: 400 });
        }
        return { choices: [{ message: { content: 'answered without tools' } }] };
      });

      const reply = await adapter.callWithTools({
        messages: [{ role: 'user', content: 'price of nvda' }],
        tools: [{ type: 'function', function: { name: 'fetch_price' } }],
      });

      expect(reply.content).toBe('answered without tools');
      expect(sent).toHaveLength(2);
      expect('tools' in sent[1]).toBe(false);
      expect('tool_choice' in sent[1]).toBe(false);
    });
  });

  it('does not retry a tool payload rejection that is really an auth failure', async () => {
    await withCustomProvider(async () => {
      const adapter = new LLMAdapter();
      let calls = 0;
      (adapter as any).customClient = async () => stubClient(async () => {
        calls++;
        throw Object.assign(new Error('invalid api key'), { status: 401 });
      });

      await expect(adapter.callWithTools({
        messages: [{ role: 'user', content: 'price of nvda' }],
        tools: [{ type: 'function', function: { name: 'fetch_price' } }],
      })).rejects.toThrow('invalid api key');
      expect(calls).toBe(1);
    });
  });

  it('reads a non-streaming body a router returned for a streaming call', async () => {
    await withCustomProvider(async () => {
      const adapter = new LLMAdapter();
      (adapter as any).customClient = async () => stubClient(async () => ({
        choices: [{ message: { content: 'Hello there.' } }],
      }));

      const chunks: string[] = [];
      for await (const chunk of adapter.callTextStream({
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        if (chunk.type === 'text') chunks.push(chunk.text);
      }

      expect(chunks.join('')).toBe('Hello there.');
    });
  });
});
