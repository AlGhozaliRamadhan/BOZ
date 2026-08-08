import OpenAI from 'openai';
import axios from 'axios';
import { config } from '../../config/config.js';
import type { LLMMessage, RawToolCall } from '../../types/llm.types.js';
import type { ValidateFunction } from 'ajv';
import { formatSchemaErrors } from './llm.schemas.js';

export type JsonCallResult<T> =
  | { type: 'ok'; value: T; raw: string; warnings: string[] }
  | { type: 'invalid_json'; raw: string; errors: string[] }
  | { type: 'schema_error'; raw: string; errors: string[] };

export type NvidiaMode = 'default' | 'analysis';
export type ReasoningEffort = 'low' | 'medium' | 'high';

const REASONING_BUDGETS: Record<ReasoningEffort, number> = {
  low: 4096,
  medium: 8192,
  high: 16384,
};

const DEFAULT_TIMEOUT_MS = 90_000;

export class LLMAdapter {
  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  private buildMessages(
    base: LLMMessage[],
    assistantPrefill?: string,
  ): LLMMessage[] {
    if (!assistantPrefill) return base;
    return [...base, { role: 'assistant', content: assistantPrefill }];
  }

  async callText(options: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
    model?: string;
    responseFormat?: 'json';
    nvidiaMode?: NvidiaMode;
    reasoningEffort?: ReasoningEffort;
    assistantPrefill?: string;
  }): Promise<string> {
    const provider = config.aiProvider ?? 'github';
    const temperature = options.temperature ?? 0.4;
    const maxTokens = options.maxTokens ?? 1500;
    const model = options.model;
    const messages = this.buildMessages(options.messages, options.assistantPrefill);

    if (provider === 'nvidia') {
      if (!config.nvidia.apiKey) throw new Error('No NVIDIA API key configured');
      const client = new OpenAI({ apiKey: config.nvidia.apiKey, baseURL: config.nvidia.baseURL });
      const modelName = model ?? config.nvidia.model;
      const params: Record<string, any> = {
        model: modelName,
        messages: messages as any,
        temperature,
        max_tokens: maxTokens,
      };
      if (options.responseFormat === 'json') {
        params.response_format = { type: 'json_object' };
      }
      const isReasoning = modelName.includes('nemotron') || modelName.includes('deepseek') || modelName.includes('qwen') || modelName.includes('qwq');
      if (isReasoning || options.nvidiaMode === 'analysis' || options.reasoningEffort) {
        if (modelName.startsWith('deepseek-ai/')) {
          params.extra_body = { chat_template_kwargs: { thinking: true } };
        } else {
          params.reasoning_budget = options.reasoningEffort ? REASONING_BUDGETS[options.reasoningEffort] : 16384;
          params.chat_template_kwargs = { enable_thinking: true };
        }
      }
      const res = await client.chat.completions.create(params as any);
      return LLMAdapter.stripThinking(res.choices?.[0]?.message?.content ?? '');
    }

    if (provider === 'offline') {
      if (!config.aiEndpoint) throw new Error('No offline endpoint configured');
      const res = await axios.post(
        `${config.aiEndpoint.replace(/\/$/, '')}/api/chat`,
        {
          model: model ?? config.aiModel,
          messages,
          stream: false,
        },
        { timeout: this.timeoutMs },
      );
      const raw: string = res.data.message?.content ?? res.data.response ?? '';
      return LLMAdapter.stripThinking(raw);
    }

    if (!config.github.token) throw new Error('No GitHub token configured');
    const githubBody: Record<string, any> = {
      model: model ?? config.github.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };
    if (options.reasoningEffort) {
      githubBody.reasoning_effort = options.reasoningEffort;
    }
    const res = await axios.post(
      `${config.github.endpoint}/chat/completions`,
      githubBody,
      { headers: { Authorization: `Bearer ${config.github.token}` }, timeout: this.timeoutMs },
    );
    const content = res.data.choices?.[0]?.message?.content ?? '';
    return LLMAdapter.stripThinking(content);
  }

  async *callTextStream(options: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
    model?: string;
    responseFormat?: 'json';
    nvidiaMode?: NvidiaMode;
    reasoningEffort?: ReasoningEffort;
    assistantPrefill?: string;
  }): AsyncGenerator<string, void, unknown> {
    const provider = config.aiProvider ?? 'github';
    const temperature = options.temperature ?? 0.4;
    const maxTokens = options.maxTokens ?? 1500;
    const model = options.model;
    const messages = this.buildMessages(options.messages, options.assistantPrefill);

    if (provider === 'nvidia') {
      if (!config.nvidia.apiKey) throw new Error('No NVIDIA API key configured');
      const client = new OpenAI({ apiKey: config.nvidia.apiKey, baseURL: config.nvidia.baseURL });
      const modelName = model ?? config.nvidia.model;
      const params: Record<string, any> = {
        model: modelName,
        messages: messages as any,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      };
      if (options.responseFormat === 'json') {
        params.response_format = { type: 'json_object' };
      }
      const isReasoning = modelName.includes('nemotron') || modelName.includes('deepseek') || modelName.includes('qwen') || modelName.includes('qwq');
      if (isReasoning || options.nvidiaMode === 'analysis' || options.reasoningEffort) {
        if (modelName.startsWith('deepseek-ai/')) {
          params.extra_body = { chat_template_kwargs: { thinking: true } };
        } else {
          params.reasoning_budget = options.reasoningEffort ? REASONING_BUDGETS[options.reasoningEffort] : 16384;
          params.chat_template_kwargs = { enable_thinking: true };
        }
      }
      const stream = await client.chat.completions.create(params as any);
      for await (const chunk of stream as any) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          yield `<think>${delta.reasoning_content}</think>`;
        }
        if (delta?.content) {
          yield delta.content;
        }
      }
      return;
    }

    if (provider === 'offline') {
      // Offline fallback to non-streaming if actual streaming is complex
      const fullResponse = await this.callText(options);
      yield fullResponse;
      return;
    }

    // GitHub Provider fallback to standard OpenAI client since it's compatible
    if (!config.github.token) throw new Error('No GitHub token configured');
    const client = new OpenAI({ apiKey: config.github.token, baseURL: config.github.endpoint });
    const modelName = model ?? config.github.model;
    const params: Record<string, any> = {
      model: modelName,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };
    if (options.responseFormat === 'json') {
      params.response_format = { type: 'json_object' };
    }
    if (options.reasoningEffort) {
      params.reasoning_effort = options.reasoningEffort;
    }
    const stream = await client.chat.completions.create(params as any);
    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) {
        yield `<think>${delta.reasoning_content}</think>`;
      }
      if (delta?.content) {
        yield delta.content;
      }
    }
  }

  async callWithTools(options: {
    messages: LLMMessage[];
    tools: object[];
    temperature?: number;
    maxTokens?: number;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    assistantPrefill?: string;
  }): Promise<LLMMessage> {
    const provider = config.aiProvider ?? 'github';
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 4096;
    const model = options.model;
    const messages = this.buildMessages(options.messages, options.assistantPrefill);

    if (provider === 'nvidia') {
      if (!config.nvidia.apiKey) throw new Error('No NVIDIA API key configured');
      const client = new OpenAI({ apiKey: config.nvidia.apiKey, baseURL: config.nvidia.baseURL });
      const modelName = model ?? config.nvidia.model;
      const params: Record<string, any> = {
        model: modelName,
        messages: messages as any,
        tools: options.tools as any,
        tool_choice: 'auto',
        temperature,
        max_tokens: maxTokens,
      };
      if (options.reasoningEffort) {
        params.reasoning_budget = REASONING_BUDGETS[options.reasoningEffort];
        params.chat_template_kwargs = { enable_thinking: true };
      }
      const res = await client.chat.completions.create(params as any);
      return LLMAdapter.normalizeOpenAIResponse(res.choices?.[0]?.message ?? {});
    }

    if (provider === 'offline') {
      return this.callOfflineTooling(messages, options.tools, model);
    }

    if (!config.github.token) throw new Error('No GitHub token configured');
    const githubBody: Record<string, any> = {
      model: model ?? config.github.model,
      messages,
      tools: options.tools,
      tool_choice: 'auto',
      temperature,
      max_tokens: maxTokens,
    };
    if (options.reasoningEffort) {
      githubBody.reasoning_effort = options.reasoningEffort;
    }
    const res = await axios.post(
      `${config.github.endpoint}/chat/completions`,
      githubBody,
      { headers: { Authorization: `Bearer ${config.github.token}` }, timeout: this.timeoutMs },
    );
    return LLMAdapter.normalizeOpenAIResponse(res.data.choices?.[0]?.message ?? {});
  }

  async callJSON<T>(options: {
    messages: LLMMessage[];
    validator: ValidateFunction;
    temperature?: number;
    maxTokens?: number;
    model?: string;
    nvidiaMode?: NvidiaMode;
  }): Promise<JsonCallResult<T>> {
    const raw = await this.callText({
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      model: options.model,
      responseFormat: 'json',
      nvidiaMode: options.nvidiaMode,
    });

    const extracted = LLMAdapter.extractJson(raw);
    if (!extracted) {
      return { type: 'invalid_json', raw, errors: ['No JSON object found in response'] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.jsonText);
    } catch (err: any) {
      return { type: 'invalid_json', raw, errors: [err?.message ?? 'Invalid JSON'] };
    }

    const valid = options.validator(parsed);
    if (!valid) {
      return {
        type: 'schema_error',
        raw,
        errors: formatSchemaErrors(options.validator.errors),
      };
    }

    return { type: 'ok', value: parsed as T, raw, warnings: extracted.warnings };
  }

  private async callOfflineTooling(
    messages: LLMMessage[],
    tools: object[],
    modelOverride?: string,
  ): Promise<LLMMessage> {
    if (!config.aiEndpoint) throw new Error('No offline endpoint configured');
    const toolNames = (tools as any[]).map(t => t.function?.name ?? '').join(', ');
    const injected: LLMMessage[] = [
      ...messages,
      {
        role: 'system',
        content:
          `You have access to these tools: ${toolNames}.\n` +
          `To call a tool respond ONLY with valid JSON:\n` +
          `{"tool":"<name>","args":{...}}\n` +
          `To call multiple tools, put each on its own line as a separate JSON object.`,
      },
    ];

    const res = await axios.post(
      `${config.aiEndpoint.replace(/\/$/, '')}/api/chat`,
      { model: modelOverride ?? config.aiModel, messages: injected, stream: false },
      { timeout: this.timeoutMs },
    );
    const raw: string = res.data.message?.content ?? res.data.response ?? '';
    return LLMAdapter.parseOfflineToolResponse(raw);
  }

  static extractJson(raw: string): { jsonText: string; warnings: string[] } | null {
    if (!raw) return null;
    let text = raw.trim();
    const warnings: string[] = [];

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
      warnings.push('Stripped markdown code fences from response');
    }

    // Try the whole string first
    try {
      JSON.parse(text);
      return { jsonText: text, warnings };
    } catch {
      // Not valid as-is, continue
    }

    // Progressive extraction: find matching {} using bracket counting
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = text.slice(start, i + 1);
          try {
            JSON.parse(candidate);
            if (start !== 0 || i !== text.length - 1) {
              warnings.push('Trimmed non-JSON text around response');
            }
            return { jsonText: candidate, warnings };
          } catch {
            // continue searching for another valid pair
          }
        }
      }
    }

    return null;
  }

  private static parseOfflineToolResponse(raw: string): LLMMessage {
    const cleaned = LLMAdapter.stripThinking(raw).trim();
    const toolCalls: RawToolCall[] = [];

    for (const line of cleaned.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed.tool && typeof parsed.tool === 'string') {
          toolCalls.push({
            id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'function',
            function: { name: parsed.tool, arguments: JSON.stringify(parsed.args ?? {}) },
          });
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    return {
      role: 'assistant',
      content: toolCalls.length === 0 ? cleaned : null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private static normalizeOpenAIResponse(msg: any): LLMMessage {
    let rawContent = msg.content ?? '';

    // Strip the assistant prefill echo if the model repeated it at the start
    // of its response (e.g. "<think>\nThinking Process:\n1. " or just
    // "Thinking Process:\n1. ").
    rawContent = rawContent.replace(/^<think>\s*\n?\s*Thinking Process:\s*\n?\s*1\.\s*/i, '');
    rawContent = rawContent.replace(/^Thinking Process:\s*\n?\s*1\.\s*/i, '');

    let content = LLMAdapter.stripThinking(rawContent) || null;

    // Native reasoning models (Nemotron, DeepSeek, QwQ on NVIDIA) return
    // their reasoning in a separate `reasoning_content` field. Capture it so
    // the engine can surface it as a thought block even when no <think>
    // tags are present in `content`.
    const nativeReasoning = (msg.reasoning_content ?? msg.reasoning ?? '').toString().trim();

    let thought: string | null = null;
    if (nativeReasoning) {
      thought = nativeReasoning;
    } else {
      const thinkingMatch = rawContent.match(/<think(?:ing)?>(.*?)<\/think(?:ing)?>/s);
      if (thinkingMatch) {
        thought = thinkingMatch[1].trim();
      } else if (rawContent.length > 0 && rawContent !== (content ?? '')) {
        const thinkingEnd = rawContent.indexOf('</thinking>');
        if (thinkingEnd !== -1) {
            const thinkStart = rawContent.indexOf('<thinking>');
            thought = rawContent.substring(thinkStart !== -1 ? thinkStart + 10 : 0, thinkingEnd).trim();
        } else {
            const thinkEnd = rawContent.indexOf('</think>');
            if (thinkEnd !== -1) {
                const thinkStart = rawContent.indexOf('<think>');
                thought = rawContent.substring(thinkStart !== -1 ? thinkStart + 7 : 0, thinkEnd).trim();
            }
        }
      }
    }

    const hasTools = msg.tool_calls && msg.tool_calls.length > 0;

    if (!thought && rawContent.trim().length > 0) {
        if (hasTools) {
            // Models like Nemotron output reasoning text before tool calls without tags
            thought = rawContent.trim();
            content = null; // Since all text was thought, there is no final content
        }
    }

    return {
      role: 'assistant',
      content,
      thought,
      tool_calls: msg.tool_calls ?? undefined,
    };
  }

  private static stripThinking(text: string): string {
    if (!text) return '';
    // Prefer </thinking> (models like DeepSeek, QwQ) with fallback to </think>
    const thinkingEnd = text.indexOf('</thinking>');
    if (thinkingEnd !== -1) {
      return text.slice(thinkingEnd + '</thinking>'.length).trim();
    }
    const thinkEnd = text.indexOf('</think>');
    if (thinkEnd !== -1) {
      return text.slice(thinkEnd + '</think>'.length).trim();
    }
    return text.trim();
  }
}
