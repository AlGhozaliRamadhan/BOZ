import OpenAI from 'openai';
import { config } from '../config/config.js';
import { GITHUB_TOKEN_URL } from '../config/github.config.js';
import { NVIDIA_API_KEY_URL } from '../config/nvidia.config.js';
import { log, clr } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIResultStatus = 'ok' | 'error' | 'uncertain';

export type AIResult =
  | {
      status:        'ok';
      prediction:    'UP' | 'DOWN' | 'UNKNOWN';
      confidence:    number;
      strategy?:     string;
      target_price?: number;
      stop_loss?:    number;
      raw_response?: string;
    }
  | { status: 'error';     reason: string }
  | { status: 'uncertain'; reason: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 90_000;

const FALLBACK_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-5',
] as const;

const RESPONSE_PATTERN =
  /PREDICTION:\s*(UP|DOWN).*?CONFIDENCE:\s*(\d+).*?STRATEGY:\s*([^\n]+).*?TARGET:\s*\$?([\d,]+\.?\d*).*?STOP:\s*\$?([\d,]+\.?\d*)/is;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uncertain = (reason: string): AIResult => ({ status: 'uncertain', reason });
const errResult = (reason: string): AIResult => ({ status: 'error',     reason });

/** The system-level analysis preamble injected for all providers */
function buildAnalysisPrompt(userPrompt: string): string {
  return (
    `You are a senior NVDA stock analyst at a top hedge fund. Your job is to produce ` +
    `an UNBIASED, data-driven intraday prediction. You have NO directional preference — ` +
    `bearish calls are equally valid and professionally respected as bullish ones.\n\n` +
    `REASONING FRAMEWORK (apply in order):\n` +
    `1. TECHNICAL SIGNALS: Weight validated patterns, volume, multi-timeframe confluence.\n` +
    `2. CROWD SENTIMENT (CONTRARIAN RULE — MANDATORY):\n` +
    `   - StockTwits >70% bullish → treat as BEARISH contrarian signal (retail euphoria precedes reversals).\n` +
    `   - StockTwits <30% bullish → treat as BULLISH contrarian signal (retail panic = dip opportunity).\n` +
    `   - Fear & Greed >75 (Extreme Greed) → reduce confidence in long positions.\n` +
    `   - Fear & Greed <25 (Extreme Fear) → increase confidence in long positions.\n` +
    `   - Do NOT use crowd consensus as confirmation — it is a contrarian indicator.\n` +
    `3. MACRO CONTEXT: Consider SPY/QQQ correlation and sector momentum.\n` +
    `4. CROSS-VALIDATION: Bull case requires ≥3 independent confirming signals. If <3, confidence ≤55%.\n` +
    `5. TIMING: If price already moved significantly, lower confidence and tighten stops.\n\n` +
    `ANTI-BIAS CHECKLIST (complete mentally before giving your answer):\n` +
    `  ✗ Am I defaulting to bullish because NVDA "usually goes up"? If yes, reconsider.\n` +
    `  ✗ Am I ignoring the contrarian crowd signal? If crowd >70% bullish, that is a RED FLAG.\n` +
    `  ✗ Have I stated the strongest BEAR case, even if I predict UP?\n\n` +
    userPrompt
  );
}

function buildWaterfall(): string[] {
  const primary = config.aiModel;
  const seen    = new Set<string>([primary]);
  const tail    = FALLBACK_MODELS.filter((m) => !seen.has(m));
  return [primary, ...tail];
}

// ─── AIService ────────────────────────────────────────────────────────────────

export class AIService {
  analyze(prompt: string): Promise<AIResult> {
    switch (config.aiProvider) {
      case 'offline': return this.analyzeWithOffline(prompt);
      case 'nvidia':  return this.analyzeWithNvidia(prompt);
      default:        return this.analyzeWithGitHub(prompt);
    }
  }

  // ─── GitHub Models ────────────────────────────────────────────────────────

  private async analyzeWithGitHub(prompt: string): Promise<AIResult> {
    const token = config.github.token;
    if (!token) {
      log.warn('ai', `No GitHub token — set GITHUB_TOKEN.  Get one at: ${GITHUB_TOKEN_URL}`);
      return uncertain('No GitHub token');
    }

    const endpoint      = `${config.github.endpoint}/chat/completions`;
    const combinedPrompt = buildAnalysisPrompt(prompt);
    const models         = buildWaterfall();
    const primary        = models[0];
    let   lastError      = '';

    for (const model of models) {
      const isFallback = model !== primary;

      console.log('');
      log.ai(isFallback ? 'fallback' : 'model', clr.white(model));
      log.ai('endpoint', clr.dim(endpoint));
      log.ai('timeout',  clr.dim((TIMEOUT_MS / 1000) + 's'));

      const result = await this.callOnce(endpoint, token, model, combinedPrompt);

      if (result.type === 'ok') {
        if (isFallback) log.ok('ai', `Success via fallback  ${clr.dim(model)}`);
        return this.parseResponse(result.content);
      }

      if (result.type === 'rate_limit') {
        log.warn('ai', `${clr.yellow(model)} rate-limited (429) — trying next model…`);
        lastError = `${model}: rate limited`;
        continue;
      }

      if (result.type === 'timeout') {
        log.warn('ai', `${clr.yellow(model)} timed out — trying next model…`);
        lastError = `${model}: timeout`;
        continue;
      }

      log.error('ai', `${model} — ${result.message}`);
      lastError = `${model}: ${result.message}`;

      if (result.type === 'auth_error') {
        log.error('ai', 'Token rejected — stopping fallback chain.');
        break;
      }
    }

    log.error('ai', `All models exhausted.  Last error: ${lastError}`);
    return errResult('All models failed');
  }

  // ─── Single attempt (GitHub) ───────────────────────────────────────────────

  private async callOnce(
    endpoint: string,
    token:    string,
    model:    string,
    prompt:   string,
  ): Promise<
    | { type: 'ok';         content: string }
    | { type: 'rate_limit' }
    | { type: 'timeout' }
    | { type: 'auth_error'; message: string }
    | { type: 'error';      message: string }
  > {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          max_tokens:  32000,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 429) return { type: 'rate_limit' };
      if (res.status === 401 || res.status === 403) {
        return { type: 'auth_error', message: `HTTP ${res.status} Unauthorized` };
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { type: 'error', message: `HTTP ${res.status}: ${body.slice(0, 120)}` };
      }

      const json = await res.json() as any;
      let content: string = json.choices?.[0]?.message?.content ?? '';
      if (!content) return { type: 'error', message: 'Empty content in response' };

      log.ok('ai', `Response received  ${clr.dim(content.length + ' chars')}`);

      if (content.includes('</think>')) {
        content = content.split('</think>').pop()!.trim();
        log.info('ai', 'Stripped <think> block');
      }

      return { type: 'ok', content };

    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') return { type: 'timeout' };
      return { type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── NVIDIA NIM ────────────────────────────────────────────────────────────
  // Supports Nemotron (reasoning) and DeepSeek V4 Pro (chat_template_kwargs)

  private async analyzeWithNvidia(prompt: string): Promise<AIResult> {
    const apiKey = config.nvidia.apiKey;
    if (!apiKey) {
      log.warn('ai', `No NVIDIA API key — set NVIDIA_API_KEY.  Get one at: ${NVIDIA_API_KEY_URL}`);
      return uncertain('No NVIDIA API key');
    }

    const model    = config.nvidia.model;
    const baseURL  = config.nvidia.baseURL;

    console.log('');
    log.ai('model',    clr.white(model));
    log.ai('endpoint', clr.dim(baseURL));
    log.ai('timeout',  clr.dim((TIMEOUT_MS / 1000) + 's'));

    const client = new OpenAI({ apiKey, baseURL });

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // DeepSeek V4 Pro uses chat_template_kwargs.thinking instead of
    // reasoning_budget / enable_thinking used by Nemotron.
    const isDeepSeek = model.startsWith('deepseek-ai/');

    try {
      const nvidiaParams = isDeepSeek
        ? {
            model,
            messages:             [{ role: 'user', content: buildAnalysisPrompt(prompt) }],
            temperature:          1,
            top_p:                0.95,
            max_tokens:           16384,
            extra_body:           { chat_template_kwargs: { thinking: false } },
            stream:               true as const,
          }
        : {
            model,
            messages:             [{ role: 'user', content: buildAnalysisPrompt(prompt) }],
            temperature:          1,
            top_p:                0.95,
            max_tokens:           16384,
            reasoning_budget:     16384,
            chat_template_kwargs: { enable_thinking: true },
            stream:               true as const,
          };

      const stream = await client.chat.completions.create(nvidiaParams as any) as unknown as AsyncIterable<any>;

      clearTimeout(timeoutId);

      let reasoning = '';
      let content   = '';
      let chunkCount = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as any;
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        if (delta?.content)           content   += delta.content;
        chunkCount++;
      }

      if (!content && !reasoning) {
        return errResult('Empty response from NVIDIA NIM');
      }

      log.ok('ai', `Stream complete  ${clr.dim(chunkCount + ' chunks · ' + content.length + ' chars')}`);

      if (reasoning) {
        log.info('ai', `Thinking tokens: ${clr.dim(reasoning.length + ' chars')}`);
      }

      // Strip any residual <think> wrappers from the content field
      let finalContent = content || reasoning;
      if (finalContent.includes('</think>')) {
        finalContent = finalContent.split('</think>').pop()!.trim();
        log.info('ai', 'Stripped <think> block from content');
      }

      return this.parseResponse(finalContent);

    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        log.error('ai', 'NVIDIA request timed out');
        return errResult('NVIDIA request timed out');
      }
      log.error('ai', `NVIDIA error: ${msg}`);
      return errResult(`NVIDIA API call failed: ${msg}`);
    }
  }

  // ─── Offline / Ollama ─────────────────────────────────────────────────────

  private async analyzeWithOffline(prompt: string): Promise<AIResult> {
    const endpoint = config.aiEndpoint?.replace(/\/$/, '');
    if (!endpoint) {
      log.warn('ai', 'Cannot run offline analysis without OFFLINE_AI_URL.');
      return uncertain('No offline endpoint');
    }

    log.ai('mode',     'Offline (Ollama-compatible)');
    log.ai('endpoint', clr.dim(endpoint));
    log.ai('model',    clr.dim(config.aiModel));

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${endpoint}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    config.aiModel,
          messages: [{ role: 'user', content: prompt }],
          stream:   false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data    = await res.json() as any;
      const content = (data?.message?.content ?? data?.response ?? '') as string;
      if (!content) return errResult('Empty response from offline AI');

      return this.parseResponse(content);

    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ai', `Offline error: ${msg}`);
      return errResult('Offline API call failed');
    }
  }

  // ─── Response Parsing ─────────────────────────────────────────────────────

  private parseResponse(content: string): AIResult {
    const match = content.match(RESPONSE_PATTERN);

    if (match) {
      log.ok('ai', 'Structured prediction parsed successfully.');
      const rawTarget = parseFloat(match[4].replace(/,/g, ''));
      const rawStop   = parseFloat(match[5].replace(/,/g, ''));
      const target_price = rawTarget > 0 ? rawTarget : undefined;
      const stop_loss    = rawStop   > 0 ? rawStop   : undefined;
      return {
        status:       'ok',
        prediction:   match[1].toUpperCase() as 'UP' | 'DOWN',
        confidence:   parseInt(match[2], 10),
        strategy:     match[3].trim(),
        target_price,
        stop_loss,
        raw_response: content,
      };
    }

    log.warn('ai', 'No structured prediction — returning raw response.');
    return {
      status:       'ok',
      prediction:   'UNKNOWN',
      confidence:   50,
      raw_response: content,
    };
  }
}
