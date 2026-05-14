import { config } from '../config/config.js';
import { GITHUB_TOKEN_URL } from '../config/github.config.js';
import { NVIDIA_API_KEY_URL } from '../config/nvidia.config.js';
import { log, clr } from '../utils/logger.js';
import { LLMAdapter } from './llm.adapter.js';
import { formatSchemaErrors, validateAiPrediction } from './llm.schemas.js';

interface AIPredictionPayload {
  status: 'ok' | 'uncertain' | 'error';
  prediction?: 'UP' | 'DOWN' | 'UNKNOWN';
  confidence?: number;
  strategy?: string;
  target_price?: number | null;
  stop_loss?: number | null;
  reasons?: string[];
  reason?: string;
}

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
      reasons?:      string[];
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

const JSON_OUTPUT_RULES = [
  'OUTPUT JSON ONLY. No markdown, no commentary.',
  'Schema:',
  '{',
  '  "status": "ok|uncertain|error",',
  '  "prediction": "UP|DOWN|UNKNOWN",',
  '  "confidence": 0-100,',
  '  "strategy": "string",',
  '  "target_price": number|null,',
  '  "stop_loss": number|null,',
  '  "reasons": ["string", ...],',
  '  "reason": "string" // required when status != ok',
  '}',
  'If data is insufficient, set status to "uncertain", prediction to "UNKNOWN", and explain in reason.',
].join('\n');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uncertain = (reason: string): AIResult => ({ status: 'uncertain', reason });
const errResult = (reason: string): AIResult => ({ status: 'error',     reason });

/** The system-level analysis preamble injected for all providers */
function buildAnalysisPrompt(userPrompt: string): string {
  return (
    `You are a senior ${config.ticker} stock analyst at a top hedge fund. Your job is to produce ` +
    `ruthlessly objective, high-conviction analysis based on the provided technical, macro, ` +
    `and sentiment data. You have NO directional preference — ` +
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
    // Removed anti-bias checklist after observing reduced accuracy; prefer explicit accuracy checks.
    `ACCURACY CHECK (do before answering):\n` +
    `  - Use only evidence from the provided data; do not invent metrics or news.\n` +
    `  - If a key data point is missing, say so and lower confidence.\n` +
    `  - Ensure prediction, confidence, and levels align with cited signals.\n\n` +
    userPrompt +
    `\n\n` +
    JSON_OUTPUT_RULES
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
  private readonly llm = new LLMAdapter();

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

    const messages = [{ role: 'user' as const, content: combinedPrompt }];

    for (const model of models) {
      const isFallback = model !== primary;

      console.log('');
      log.ai(isFallback ? 'fallback' : 'model', clr.white(model));
      log.ai('endpoint', clr.dim(endpoint));
      log.ai('timeout',  clr.dim((TIMEOUT_MS / 1000) + 's'));

      try {
        const content = await this.llm.callText({
          messages,
          temperature: 0.3,
          maxTokens: 2000,
          model,
          responseFormat: 'json',
        });

        const parsed = this.validateResponse(content);
        if (parsed.ok) {
          if (isFallback) log.ok('ai', `Success via fallback  ${clr.dim(model)}`);
          if (parsed.warnings.length > 0) {
            parsed.warnings.forEach(w => log.warn('ai', w));
          }
          return parsed.result;
        }

        lastError = `${model}: ${parsed.error}`;
        log.warn('ai', `${clr.yellow(model)} invalid JSON — trying next model…`);
        continue;

      } catch (err: any) {
        const status: number | undefined = err?.response?.status ?? err?.status;
        if (status === 429) {
          log.warn('ai', `${clr.yellow(model)} rate-limited (429) — trying next model…`);
          lastError = `${model}: rate limited`;
          continue;
        }

        if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
          log.warn('ai', `${clr.yellow(model)} timed out — trying next model…`);
          lastError = `${model}: timeout`;
          continue;
        }

        if (status === 401 || status === 403) {
          log.error('ai', `${model} — HTTP ${status} Unauthorized`);
          log.error('ai', 'Token rejected — stopping fallback chain.');
          lastError = `${model}: auth_error`;
          break;
        }

        log.error('ai', `${model} — ${err?.message ?? 'Unknown error'}`);
        lastError = `${model}: ${err?.message ?? 'Unknown error'}`;
      }
    }

    log.error('ai', `All models exhausted.  Last error: ${lastError}`);
    return errResult('All models failed');
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

    try {
      const content = await this.llm.callText({
        messages: [{ role: 'user', content: buildAnalysisPrompt(prompt) }],
        temperature: 0.3,
        maxTokens: 2000,
        responseFormat: 'json',
        nvidiaMode: 'analysis',
      });

      const parsed = this.validateResponse(content);
      if (parsed.ok) {
        if (parsed.warnings.length > 0) {
          parsed.warnings.forEach(w => log.warn('ai', w));
        }
        return parsed.result;
      }

      log.error('ai', `Invalid JSON from NVIDIA NIM: ${parsed.error}`);
      return uncertain('NVIDIA response failed schema validation');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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

    try {
      const content = await this.llm.callText({
        messages: [{ role: 'user', content: buildAnalysisPrompt(prompt) }],
        temperature: 0.3,
        maxTokens: 2000,
        responseFormat: 'json',
      });

      const parsed = this.validateResponse(content);
      if (parsed.ok) {
        if (parsed.warnings.length > 0) {
          parsed.warnings.forEach(w => log.warn('ai', w));
        }
        return parsed.result;
      }

      log.warn('ai', `Invalid JSON from offline AI: ${parsed.error}`);
      return uncertain('Offline response failed schema validation');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ai', `Offline error: ${msg}`);
      return errResult('Offline API call failed');
    }
  }

  // ─── Response Parsing ─────────────────────────────────────────────────────

  private validateResponse(content: string):
    | { ok: true; result: AIResult; warnings: string[] }
    | { ok: false; error: string; warnings: string[] } {
    const extracted = LLMAdapter.extractJson(content);
    if (!extracted) {
      return { ok: false, error: 'No JSON object found', warnings: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.jsonText);
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message ?? 'Invalid JSON',
        warnings: extracted.warnings,
      };
    }

    const valid = validateAiPrediction(parsed);
    if (!valid) {
      const errors = formatSchemaErrors(validateAiPrediction.errors).join('; ');
      return { ok: false, error: errors || 'Schema validation failed', warnings: extracted.warnings };
    }

    const result = this.normalizeResult(parsed as AIPredictionPayload, extracted.jsonText);
    return { ok: true, result, warnings: extracted.warnings };
  }

  private normalizeResult(payload: AIPredictionPayload, raw: string): AIResult {
    if (payload.status !== 'ok') {
      return { status: payload.status, reason: payload.reason ?? 'Model returned no reason' };
    }

    const confidence = Math.max(0, Math.min(100, Math.round(payload.confidence ?? 50)));
    const reasons = payload.reasons?.filter(r => r.trim().length > 0).slice(0, 5);

    return {
      status: 'ok',
      prediction: (payload.prediction ?? 'UNKNOWN') as 'UP' | 'DOWN' | 'UNKNOWN',
      confidence,
      strategy: payload.strategy?.trim() || undefined,
      target_price: payload.target_price ?? undefined,
      stop_loss: payload.stop_loss ?? undefined,
      reasons: reasons && reasons.length > 0 ? reasons : undefined,
      raw_response: raw,
    };
  }

  public parseResponse(content: string): AIResult {
    const parsed = this.validateResponse(content);
    if (parsed.ok) return parsed.result;
    return uncertain(`Invalid JSON response: ${parsed.error}`);
  }
}
