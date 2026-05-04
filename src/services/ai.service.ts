import { config } from '../config/config.js';
import { GITHUB_TOKEN_URL } from '../config/github.config.js';
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

function buildWaterfall(): string[] {
  const primary = config.aiModel;
  const seen    = new Set<string>([primary]);
  const tail    = FALLBACK_MODELS.filter((m) => !seen.has(m));
  return [primary, ...tail];
}

// ─── AIService ────────────────────────────────────────────────────────────────

export class AIService {
  analyze(prompt: string): Promise<AIResult> {
    return config.aiProvider === 'offline'
      ? this.analyzeWithOffline(prompt)
      : this.analyzeWithGitHub(prompt);
  }

  // ─── GitHub Models ────────────────────────────────────────────────────────

  private async analyzeWithGitHub(prompt: string): Promise<AIResult> {
    const token = config.github.token;
    if (!token) {
      log.warn('ai', `No GitHub token — set GITHUB_TOKEN.  Get one at: ${GITHUB_TOKEN_URL}`);
      return uncertain('No GitHub token');
    }

    const endpoint = `${config.github.endpoint}/chat/completions`;

    const combinedPrompt =
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
      prompt;

    const models  = buildWaterfall();
    const primary = models[0];
    let lastError = '';

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

  // ─── Single attempt ───────────────────────────────────────────────────────

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
          max_tokens:  32000, // R1/o-series thinking models consume most tokens in <think>; 4k was truncating the actual response
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
      return {
        status:       'ok',
        prediction:   match[1].toUpperCase() as 'UP' | 'DOWN',
        confidence:   parseInt(match[2], 10),
        strategy:     match[3].trim(),
        target_price: parseFloat(match[4].replace(/,/g, '')),
        stop_loss:    parseFloat(match[5].replace(/,/g, '')),
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
