// ─── agents/base.agent.ts ─────────────────────────────────────────────────────
// Abstract base class for all ReAct-style agents in this project.
//
// Every future agent (NewsIntelAgent, MarketAgent, …) extends BaseAgent and
// only needs to implement four abstract methods:
//   buildSystemPrompt()   — the agent's persona / rules
//   buildInitialPrompt()  — the first user message that kicks off the loop
//   getToolDefinitions()  — OpenAI-style function-calling schema
//   executeTool()         — maps tool name → actual async logic
//
// The ReAct loop, AI provider dispatch, soft/hard time guards, tool-call
// parsing, and THOUGHT / ACTION / OBS rendering are all handled here.
//
// Improvements:
//   • 429 / 5xx retry with exponential backoff (3 attempts)
//   • synthesiseFinish() called on error-exit so partial state is never lost
//   • null-guard on assistantMsg.content before printThought

import OpenAI from 'openai';
import axios  from 'axios';
import { log, clr } from '../utils/logger.js';
import { config }   from '../config/config.js';

// ─── Shared message / tool-call types ────────────────────────────────────────

export interface AgentMessage {
  role:          'system' | 'user' | 'assistant' | 'tool';
  content:       string | null;
  tool_calls?:   RawToolCall[];
  tool_call_id?: string;
  name?:         string;
}

export interface RawToolCall {
  id:       string;
  type:     'function';
  function: { name: string; arguments: string };
}

export interface ParsedToolCall {
  id:        string;
  name:      string;
  arguments: Record<string, any>;
}

// ─── BaseAgent ────────────────────────────────────────────────────────────────

export abstract class BaseAgent {
  // ── Safety limits ────────────────────────────────────────────────────────
  protected readonly TIME_LIMIT_MS  = 20 * 60 * 1000; // 20 min hard cap
  protected readonly SOFT_NUDGE_MS  = 15 * 60 * 1000; // 15 min soft nudge
  protected readonly ITER_HARD_CAP  = 80;
  private softNudgeSent             = false;

  // ── Retry config for AI calls ────────────────────────────────────────────
  private readonly AI_MAX_RETRIES   = 3;
  private readonly AI_RETRY_BASE_MS = 5_000; // 5s → 15s → 45s

  // ── Abstract surface — subclasses must implement these ───────────────────

  /** Full system prompt that defines the agent's persona, rules, and tools. */
  protected abstract buildSystemPrompt(): string;

  /** The first user message that kicks off the ReAct loop. */
  protected abstract buildInitialPrompt(): string;

  /** OpenAI function-calling tool schema (same format as TOOL_DEFINITIONS). */
  protected abstract getToolDefinitions(): object[];

  /**
   * Execute a parsed tool call and return the observation string.
   * The `state` parameter is whatever shape the subclass uses; cast it inside.
   */
  protected abstract executeTool(
    call:  ParsedToolCall,
    state: any,
  ): Promise<string>;

  // ── ReAct loop ────────────────────────────────────────────────────────────

  /**
   * Run the agent until it calls `finish`, hits a time limit, or hits the
   * iteration cap.  Returns when the loop is done.
   *
   * @param state         Mutable state object owned by the subclass.
   * @param isFinished    Predicate — returns true once the agent has called finish.
   * @param onFinishArgs  Called with the finish tool's arguments (if any).
   * @param label         Display label shown in the console header.
   */
  protected async runLoop(
    state:        any,
    isFinished:   (state: any) => boolean,
    onFinishArgs: (args: Record<string, any>, state: any) => void,
    label         = 'AGENT',
  ): Promise<{ messages: AgentMessage[]; iterations: number; elapsed: number }> {
    const startTime = Date.now();
    let   iteration  = 0;
    let   loopError  = false;
    this.softNudgeSent = false;

    const messages: AgentMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user',   content: this.buildInitialPrompt() },
    ];

    console.log('');
    console.log(clr.magenta(`  [${label}]`));
    console.log('');

    while (!isFinished(state)) {
      const elapsed = Date.now() - startTime;

      // Hard cap
      if (elapsed > this.TIME_LIMIT_MS) {
        log.warn('agent', 'Hard time limit (20 min) reached — stopping loop.');
        break;
      }
      if (iteration >= this.ITER_HARD_CAP) {
        log.warn('agent', `Hard iteration cap (${this.ITER_HARD_CAP}) reached — stopping loop.`);
        break;
      }

      // Soft nudge
      if (!this.softNudgeSent && elapsed > this.SOFT_NUDGE_MS) {
        this.softNudgeSent = true;
        log.warn('agent', 'Soft nudge: 15 min elapsed — asking agent to wrap up.');
        messages.push({
          role:    'user',
          content:
            '[SYSTEM] You have been running for 15 minutes. Please complete your ' +
            'current investigation and call `finish` soon. Summarise findings with ' +
            '`summarize_findings`, emit pending opportunities with `emit_opportunities`, ' +
            'then call `finish`.',
        });
      }

      iteration++;
      const sec    = ((Date.now() - startTime) / 1000).toFixed(0);
      const minSec = `${Math.floor(Number(sec) / 60)}m${String(Number(sec) % 60).padStart(2, '0')}s`;
      console.log(clr.dim(`\n  step ${iteration}  elapsed ${minSec}`));

      // ── Call AI (with retry on 429 / 5xx) ──────────────────────────────
      let assistantMsg: AgentMessage;
      try {
        assistantMsg = await this.callAIWithRetry(messages, this.getToolDefinitions());
      } catch (err: any) {
        log.error('agent', `AI call failed after retries: ${err.message}`);
        loopError = true;
        break;
      }

      messages.push(assistantMsg);

      // ── Print THOUGHT ──────────────────────────────────────────────────
      const thoughtText = assistantMsg.content?.trim() ?? '';
      if (thoughtText.length > 0) {
        this.printThought(thoughtText);
      }

      // ── No tool calls → reasoning only, continue ───────────────────────
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        if (thoughtText.length === 0) {
          log.warn('agent', 'Empty response — nudging agent to continue.');
          messages.push({
            role:    'user',
            content: 'Continue your analysis. Use a tool, or call `finish` when done.',
          });
        }
        continue;
      }

      // ── Execute each tool call ─────────────────────────────────────────
      for (const raw of assistantMsg.tool_calls) {
        const call = this.parseToolCall(raw);

        // ACTION header
        const argStr = JSON.stringify(call.arguments);
        console.log(`\n  ${clr.magenta('[ACTION]')}  ${clr.cyan(call.name)}`);
        if (argStr !== '{}')
          console.log(`  ${clr.dim('         ')}  ${clr.dim(argStr.slice(0, 120))}`);

        // Execute
        const result = await this.executeTool(call, state);

        // OBS
        const obsLines = result.split('\n').filter(l => l.trim()).slice(0, 10);
        console.log(`  ${clr.yellow('[OBS]')}`);
        for (const ol of obsLines)
          console.log(`  ${clr.dim('       ')} ${clr.dim(ol.slice(0, 110))}`);
        if (result.split('\n').filter(l => l.trim()).length > 10)
          console.log(`  ${clr.dim('       ')} ${clr.dim('... (truncated)')}`);

        // Feed observation back
        messages.push({
          role:         'tool',
          content:      result,
          tool_call_id: call.id,
          name:         call.name,
        });

        // Handle finish
        if (call.name === 'finish') {
          onFinishArgs(call.arguments, state);
        }
      }
    }

    // If loop exited due to an error (not a clean finish), synthesise partial
    // state so the caller always has something meaningful to render.
    if (loopError && !isFinished(state)) {
      log.warn('agent', 'Loop exited on error — synthesising partial results.');
      // Subclasses that expose synthesiseFinish override this hook.
      (this as any).synthesiseFinish?.(state);
    }

    return { messages, iterations: iteration, elapsed: Date.now() - startTime };
  }

  // ─── Retry wrapper ────────────────────────────────────────────────────────

  /**
   * Wraps callAI with exponential-backoff retry on transient errors.
   * Retries on HTTP 429 (rate-limit) and 5xx (server errors).
   * Throws only after all attempts are exhausted.
   */
  private async callAIWithRetry(
    messages:   AgentMessage[],
    tools:      object[],
    temperature = 0.3,
    maxTokens   = 4096,
  ): Promise<AgentMessage> {
    let lastErr: any;
    for (let attempt = 1; attempt <= this.AI_MAX_RETRIES; attempt++) {
      try {
        return await this.callAI(messages, tools, temperature, maxTokens);
      } catch (err: any) {
        lastErr = err;
        const status: number | undefined =
          err?.status ?? err?.response?.status ?? err?.statusCode;
        const isRetryable =
          status === 429 ||
          (status !== undefined && status >= 500 && status < 600) ||
          // Network-level errors (ECONNRESET, ETIMEDOUT, etc.)
          err?.code === 'ECONNRESET' ||
          err?.code === 'ETIMEDOUT'  ||
          err?.code === 'ENOTFOUND';

        if (!isRetryable || attempt === this.AI_MAX_RETRIES) break;

        const delay = this.AI_RETRY_BASE_MS * attempt; // 5s, 10s, 15s
        log.warn(
          'agent',
          `AI call failed (attempt ${attempt}/${this.AI_MAX_RETRIES}) — ` +
          `status ${status ?? err?.code ?? 'unknown'}, retrying in ${delay / 1000}s…`,
        );
        await new Promise(res => setTimeout(res, delay));
      }
    }
    throw lastErr;
  }

  // ─── AI provider dispatch ─────────────────────────────────────────────────

  /** Full tool-calling AI call — returns a structured AgentMessage. */
  protected async callAI(
    messages:    AgentMessage[],
    tools:       object[],
    temperature  = 0.3,
    maxTokens    = 4096,
  ): Promise<AgentMessage> {
    if (config.aiProvider === 'nvidia') {
      const client = new OpenAI({
        apiKey:  config.nvidia.apiKey,
        baseURL: config.nvidia.baseURL,
      });
      const res = await client.chat.completions.create({
        model:       config.nvidia.model,
        messages:    messages as any,
        tools:       tools as any,
        tool_choice: 'auto',
        temperature,
        max_tokens:  maxTokens,
      });
      return this.normalizeOpenAIResponse(res.choices[0].message);

    } else if (config.aiProvider === 'github') {
      const res = await axios.post(
        `${config.github.endpoint}/chat/completions`,
        {
          model:       config.github.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature,
          max_tokens:  maxTokens,
        },
        { headers: { Authorization: `Bearer ${config.github.token}` }, timeout: 90_000 },
      );
      return this.normalizeOpenAIResponse(res.data.choices[0].message);

    } else {
      // Ollama / offline — simulate tool calling with JSON
      return this.callAIOffline(messages, tools);
    }
  }

  /** Plain text AI call — no tools, returns raw string. */
  protected async callAIText(
    messages:   AgentMessage[],
    temperature = 0.5,
    maxTokens   = 1500,
  ): Promise<string> {
    if (config.aiProvider === 'nvidia') {
      const client = new OpenAI({
        apiKey:  config.nvidia.apiKey,
        baseURL: config.nvidia.baseURL,
      });
      const res = await client.chat.completions.create({
        model:       config.nvidia.model,
        messages:    messages as any,
        temperature,
        max_tokens:  maxTokens,
      });
      return res.choices[0].message.content ?? '';

    } else if (config.aiProvider === 'github') {
      const res = await axios.post(
        `${config.github.endpoint}/chat/completions`,
        { model: config.github.model, messages, temperature, max_tokens: maxTokens },
        { headers: { Authorization: `Bearer ${config.github.token}` }, timeout: 90_000 },
      );
      return res.data.choices[0].message.content ?? '';

    } else {
      const res = await axios.post(
        `${config.aiEndpoint}/api/chat`,
        { model: config.aiModel, messages, stream: false },
        { timeout: 120_000 },
      );
      const raw: string = res.data.message?.content ?? res.data.response ?? '';
      return raw.includes('</think>') ? raw.split('</think>').pop()!.trim() : raw.trim();
    }
  }

  // ─── Offline / Ollama tool-call simulation ────────────────────────────────

  private async callAIOffline(
    messages: AgentMessage[],
    tools:    object[],
  ): Promise<AgentMessage> {
    const toolNames = (tools as any[]).map(t => t.function?.name ?? '').join(', ');
    const injected  = [
      ...messages,
      {
        role: 'system' as const,
        content:
          `You have access to these tools: ${toolNames}.\n` +
          `To call a tool respond ONLY with valid JSON:\n` +
          `{"tool":"<name>","args":{...}}\n` +
          `To call multiple tools, put each on its own line as a separate JSON object.`,
      },
    ];
    const res = await axios.post(
      `${config.aiEndpoint}/api/chat`,
      { model: config.aiModel, messages: injected, stream: false },
      { timeout: 120_000 },
    );
    const raw: string = res.data.message?.content ?? res.data.response ?? '';
    return this.parseOfflineToolResponse(raw);
  }

  private parseOfflineToolResponse(raw: string): AgentMessage {
    const cleaned = raw.includes('</think>')
      ? raw.split('</think>').pop()!.trim()
      : raw.trim();

    const toolCalls: RawToolCall[] = [];
    for (const line of cleaned.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed.tool && typeof parsed.tool === 'string') {
          toolCalls.push({
            id:       `offline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type:     'function',
            function: { name: parsed.tool, arguments: JSON.stringify(parsed.args ?? {}) },
          });
        }
      } catch {}
    }

    return {
      role:       'assistant',
      content:    toolCalls.length === 0 ? cleaned : null,
      tool_calls: toolCalls.length > 0  ? toolCalls : undefined,
    };
  }

  private normalizeOpenAIResponse(msg: any): AgentMessage {
    return {
      role:       'assistant',
      content:    msg.content ?? null,
      tool_calls: msg.tool_calls ?? undefined,
    };
  }

  // ─── Tool call parser ─────────────────────────────────────────────────────

  protected parseToolCall(raw: RawToolCall): ParsedToolCall {
    let args: Record<string, any> = {};
    try { args = JSON.parse(raw.function.arguments); } catch {}
    return { id: raw.id, name: raw.function.name, arguments: args };
  }

  // ─── Console rendering helpers ────────────────────────────────────────────

  protected printThought(thought: string): void {
    console.log('');
    const paragraphs = thought
      .split(/\n{2,}|\n(?=[-•*\d])/)
      .map(p => p.trim())
      .filter(Boolean);

    for (const para of paragraphs) {
      const words = para.replace(/\n/g, ' ').split(/\s+/);
      let cur = '';
      let firstLine = true;
      for (const word of words) {
        const candidate = cur ? cur + ' ' + word : word;
        if (candidate.length > 74) {
          const prefix = firstLine ? clr.cyan('[THOUGHT]') : clr.dim('         ');
          console.log(`  ${prefix} ${clr.dim(cur)}`);
          cur = word;
          firstLine = false;
        } else {
          cur = candidate;
        }
      }
      if (cur) {
        const prefix = firstLine ? clr.cyan('[THOUGHT]') : clr.dim('         ');
        console.log(`  ${prefix} ${clr.dim(cur)}`);
      }
      console.log('');
    }
  }

  protected wrapText(text: string, width = 74): string[] {
    const words = (text ?? '').trim().split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (!cur) { cur = w; continue; }
      if ((cur + ' ' + w).length <= width) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
}
