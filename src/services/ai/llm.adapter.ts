import OpenAI from 'openai';
import axios from 'axios';
import { config } from '../../config/config.js';
import type { LLMMessage, RawToolCall } from '../../types/llm.types.js';
import type { ValidateFunction } from 'ajv';
import { formatSchemaErrors } from './llm.schemas.js';
import { createCustomProviderClient } from './custom-provider.client.js';
import { sanitizeAssistantOutput } from '../../shared/assistant-output.js';

export type JsonCallResult<T> =
  | { type: 'ok'; value: T; raw: string; warnings: string[] }
  | { type: 'invalid_json'; raw: string; errors: string[] }
  | { type: 'schema_error'; raw: string; errors: string[] };

export type NvidiaMode = 'default' | 'analysis';
export type ReasoningEffort = 'low' | 'medium' | 'high';
type OpenAiCompatibleCloudProvider = 'openai' | 'groq' | 'openrouter';

interface OpenAiCompatibleCloudConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  name: string;
  headers?: Record<string, string>;
}

const REASONING_BUDGETS: Record<ReasoningEffort, number> = {
  low: 4096,
  medium: 8192,
  high: 16384,
};

const DEFAULT_TIMEOUT_MS = 90_000;

export class LLMAdapter {
  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  private customClient(): Promise<OpenAI> {
    return createCustomProviderClient({
      apiKey: config.custom.apiKey,
      endpoint: config.custom.endpoint || 'http://localhost:20128/v1',
      timeoutMs: this.timeoutMs,
    });
  }

  private cloudProviderConfig(provider: OpenAiCompatibleCloudProvider): OpenAiCompatibleCloudConfig {
    if (provider === 'openai') {
      return {
        apiKey: config.openai.apiKey,
        endpoint: config.openai.endpoint,
        model: config.openai.model,
        name: 'OpenAI',
      };
    }
    if (provider === 'groq') {
      return {
        apiKey: config.groq.apiKey,
        endpoint: config.groq.endpoint,
        model: config.groq.model,
        name: 'Groq',
      };
    }
    return {
      apiKey: config.openrouter.apiKey,
      endpoint: config.openrouter.endpoint,
      model: config.openrouter.model,
      name: 'OpenRouter',
      headers: {
        'HTTP-Referer': 'https://github.com/AlGhozaliRamadhan/boz',
        'X-OpenRouter-Title': 'BOZ',
      },
    };
  }

  private cloudClient(provider: OpenAiCompatibleCloudProvider): { client: OpenAI; model: string } {
    const settings = this.cloudProviderConfig(provider);
    if (!settings.apiKey) throw new Error(`No ${settings.name} API key configured`);
    return {
      client: new OpenAI({
        apiKey: settings.apiKey,
        baseURL: settings.endpoint,
        defaultHeaders: settings.headers,
        timeout: this.timeoutMs,
      }),
      model: settings.model,
    };
  }

  private async callCloudText(
    provider: OpenAiCompatibleCloudProvider,
    options: {
      messages: LLMMessage[];
      temperature: number;
      maxTokens: number;
      model?: string;
      responseFormat?: 'json';
    },
  ): Promise<string> {
    const { client, model } = this.cloudClient(provider);
    const params: Record<string, unknown> = {
      model: options.model ?? model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };
    if (options.responseFormat === 'json') params.response_format = { type: 'json_object' };
    const response: any = await client.chat.completions.create(params as any);
    return LLMAdapter.stripThinking(response.choices?.[0]?.message?.content ?? '');
  }

  private async *streamCloudText(
    provider: OpenAiCompatibleCloudProvider,
    options: {
      messages: LLMMessage[];
      temperature: number;
      maxTokens: number;
      model?: string;
      responseFormat?: 'json';
    },
  ): AsyncGenerator<string, void, unknown> {
    const { client, model } = this.cloudClient(provider);
    const params: Record<string, unknown> = {
      model: options.model ?? model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    };
    if (options.responseFormat === 'json') params.response_format = { type: 'json_object' };
    const stream: AsyncIterable<{ choices?: { delta?: { content?: string | null } }[] }> =
      await client.chat.completions.create(params as any) as any;
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }

  private async callCloudWithTools(
    provider: OpenAiCompatibleCloudProvider,
    options: {
      messages: LLMMessage[];
      tools: object[];
      temperature: number;
      maxTokens: number;
      model?: string;
      toolChoice: { type: 'function'; function: { name: string } } | 'auto';
    },
  ): Promise<LLMMessage> {
    const { client, model } = this.cloudClient(provider);
    const response: any = await client.chat.completions.create({
      model: options.model ?? model,
      messages: options.messages as never,
      tools: options.tools as never,
      tool_choice: options.toolChoice as never,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    } as any);
    return LLMAdapter.normalizeOpenAIResponse(response.choices?.[0]?.message ?? {});
  }

  async callText(options: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
    model?: string;
    responseFormat?: 'json';
    nvidiaMode?: NvidiaMode;
    reasoningEffort?: ReasoningEffort;
  }): Promise<string> {
    const provider = config.aiProvider ?? 'github';
    const temperature = options.temperature ?? 0.4;
    const maxTokens = options.maxTokens ?? 1500;
    const model = options.model;
    const messages = options.messages;

    if (provider === 'custom') {
      const modelName = model ?? config.custom.model;
      if (!modelName) throw new Error('No custom model configured. Set CUSTOM_AI_MODEL or pick a model in chat.');
      const params: Record<string, any> = {
        model: modelName,
        messages: messages as any,
        temperature,
        max_tokens: maxTokens,
      };
      if (options.responseFormat === 'json') {
        params.response_format = { type: 'json_object' };
      }
      const client = await this.customClient();
      const res = await client.chat.completions.create(params as any);
      return LLMAdapter.stripThinking(res.choices?.[0]?.message?.content ?? '');
    }

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

    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
      return this.callCloudText(provider, {
        messages,
        temperature,
        maxTokens,
        model,
        responseFormat: options.responseFormat,
      });
    }

    if (provider === 'anthropic') {
      return this.callAnthropicText({
        messages,
        temperature,
        maxTokens,
        model,
      });
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
  }): AsyncGenerator<string, void, unknown> {
    const provider = config.aiProvider ?? 'github';
    const temperature = options.temperature ?? 0.4;
    const maxTokens = options.maxTokens ?? 1500;
    const model = options.model;
    const messages = options.messages;

    if (provider === 'custom') {
      const modelName = model ?? config.custom.model;
      if (!modelName) throw new Error('No custom model configured. Set CUSTOM_AI_MODEL or pick a model in chat.');
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
      const client = await this.customClient();
      const stream = await client.chat.completions.create(params as any);
      for await (const chunk of stream as any) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          yield delta.content;
        }
      }
      return;
    }

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
        if (delta?.content) {
          yield delta.content;
        }
      }
      return;
    }

    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
      yield* this.streamCloudText(provider, {
        messages,
        temperature,
        maxTokens,
        model,
        responseFormat: options.responseFormat,
      });
      return;
    }

    if (provider === 'anthropic') {
      // The Anthropic Messages path remains functional without a streaming-only
      // dependency; the chat engine emits this single normalized chunk.
      yield await this.callAnthropicText({ messages, temperature, maxTokens, model });
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
    toolChoice?: { type: 'function'; function: { name: string } };
  }): Promise<LLMMessage> {
    const provider = config.aiProvider ?? 'github';
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 4096;
    const model = options.model;
    const messages = options.messages;
    const toolChoice = options.toolChoice ?? 'auto';

    if (provider === 'custom') {
      const modelName = model ?? config.custom.model;
      if (!modelName) throw new Error('No custom model configured. Set CUSTOM_AI_MODEL or pick a model in chat.');
      const params: Record<string, any> = {
        model: modelName,
        messages: messages as any,
        tools: options.tools as any,
        tool_choice: toolChoice,
        temperature,
        max_tokens: maxTokens,
      };
      const client = await this.customClient();
      const res = await client.chat.completions.create(params as any);
      return LLMAdapter.normalizeOpenAIResponse(res.choices?.[0]?.message ?? {});
    }

    if (provider === 'nvidia') {
      if (!config.nvidia.apiKey) throw new Error('No NVIDIA API key configured');
      const client = new OpenAI({ apiKey: config.nvidia.apiKey, baseURL: config.nvidia.baseURL });
      const modelName = model ?? config.nvidia.model;
      const params: Record<string, any> = {
        model: modelName,
        messages: messages as any,
        tools: options.tools as any,
        tool_choice: toolChoice,
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

    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
      return this.callCloudWithTools(provider, {
        messages,
        tools: options.tools,
        temperature,
        maxTokens,
        model,
        toolChoice,
      });
    }

    if (provider === 'anthropic') {
      return this.callAnthropicWithTools({
        messages,
        tools: options.tools,
        maxTokens,
        model,
        toolChoice,
      });
    }

    if (provider === 'offline') {
      return this.callOfflineTooling(messages, options.tools, model, options.toolChoice?.function.name);
    }

    if (!config.github.token) throw new Error('No GitHub token configured');
    const githubBody: Record<string, any> = {
      model: model ?? config.github.model,
      messages,
      tools: options.tools,
      tool_choice: toolChoice,
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

  private async callAnthropicText(options: {
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    model?: string;
  }): Promise<string> {
    const response = await this.createAnthropicMessage({
      messages: options.messages,
      model: options.model ?? config.anthropic.model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
    return LLMAdapter.stripThinking(
      response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
    );
  }

  private async callAnthropicWithTools(options: {
    messages: LLMMessage[];
    tools: object[];
    maxTokens: number;
    model?: string;
    toolChoice: { type: 'function'; function: { name: string } } | 'auto';
  }): Promise<LLMMessage> {
    const tools = options.tools.flatMap((tool) => {
      const candidate = tool as {
        type?: unknown;
        function?: { name?: unknown; description?: unknown; parameters?: unknown };
      };
      const definition = candidate.function;
      if (candidate.type !== 'function' || !definition || typeof definition.name !== 'string') return [];
      return [{
        name: definition.name,
        description: typeof definition.description === 'string' ? definition.description : undefined,
        input_schema: definition.parameters && typeof definition.parameters === 'object'
          ? definition.parameters
          : { type: 'object', properties: {} },
      }];
    });
    const response = await this.createAnthropicMessage({
      messages: options.messages,
      model: options.model ?? config.anthropic.model,
      maxTokens: options.maxTokens,
      tools,
      toolChoice: options.toolChoice === 'auto'
        ? { type: 'auto' }
        : { type: 'tool', name: options.toolChoice.function.name },
    });
    const toolCalls: RawToolCall[] = response.content
      .filter((block) => block.type === 'tool_use' && block.id && block.name)
      .map((block) => ({
        id: block.id!,
        type: 'function' as const,
        function: {
          name: block.name!,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));
    const content = LLMAdapter.stripThinking(
      response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
    ) || null;
    return {
      role: 'assistant',
      content: toolCalls.length > 0 ? null : content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private async createAnthropicMessage(options: {
    messages: LLMMessage[];
    model: string;
    maxTokens: number;
    temperature?: number;
    tools?: object[];
    toolChoice?: object;
  }): Promise<{ content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> }> {
    if (!config.anthropic.apiKey) throw new Error('No Anthropic API key configured');
    const system = options.messages
      .filter((message) => message.role === 'system' && message.content)
      .map((message) => message.content)
      .join('\n\n');
    const messages = options.messages
      .filter((message) => message.role !== 'system')
      .reduce<Array<{ role: 'user' | 'assistant'; content: string | object[] }>>((converted, message) => {
        const next = this.toAnthropicMessage(message);
        // Anthropic requires multiple results from one assistant tool-use turn
        // to share a single following user message.
        if (message.role === 'tool') {
          const previous = converted[converted.length - 1];
          if (previous?.role === 'user' && Array.isArray(previous.content)) {
            previous.content.push(...(next.content as object[]));
            return converted;
          }
        }
        converted.push(next);
        return converted;
      }, []);
    const response = await fetch(`${config.anthropic.endpoint.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(system ? { system } : {}),
        messages,
        ...(options.tools?.length ? { tools: options.tools } : {}),
        ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Anthropic returned HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !Array.isArray((data as { content?: unknown }).content)) {
      throw new Error('Anthropic returned an invalid response');
    }
    return data as { content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> };
  }

  private toAnthropicMessage(message: LLMMessage): {
    role: 'user' | 'assistant';
    content: string | object[];
  } {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id ?? '',
          content: message.content ?? '',
        }],
      };
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return {
        role: 'assistant',
        content: message.tool_calls.map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: LLMAdapter.toolArguments(call.function.arguments),
        })),
      };
    }
    return {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content ?? '',
    };
  }

  private static toolArguments(raw: string): object {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
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
    forcedToolName?: string,
  ): Promise<LLMMessage> {
    if (!config.aiEndpoint) throw new Error('No offline endpoint configured');
    const toolNames = (tools as any[]).map(t => t.function?.name ?? '').join(', ');
    const injected: LLMMessage[] = [
      ...messages,
      {
        role: 'system',
        content:
          `You have access to these tools: ${toolNames}.\n` +
          (forcedToolName
            ? `You MUST call ${forcedToolName} first.\n`
            : '') +
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
    const rawContent = (msg.content ?? '').toString();
    let content = LLMAdapter.stripThinking(rawContent) || null;
    const thought: string | null = null;

    const hasTools = msg.tool_calls && msg.tool_calls.length > 0;

    if (hasTools) content = null;

    return {
      role: 'assistant',
      content,
      thought,
      tool_calls: msg.tool_calls ?? undefined,
    };
  }

  private static stripThinking(text: string): string {
    return sanitizeAssistantOutput(text);
  }
}
