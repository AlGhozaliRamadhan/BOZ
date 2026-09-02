import { config } from '../../config/config.js';
import { GITHUB_TOKEN_URL } from '../../config/github.config.js';
import { NVIDIA_API_KEY_URL } from '../../config/nvidia.config.js';
import { log, clr } from '../../utils/logger.js';
import { LLMAdapter } from './llm.adapter.js';
import { formatSchemaErrors, validateAiPrediction } from './llm.schemas.js';

interface AIPredictionPayload {
  status: 'ok' | 'uncertain' | 'error';
  prediction?: 'UP' | 'DOWN' | 'UNKNOWN';
  confidence?: number;
  strategy?: string;
  thesis?: string;
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
      thesis?:       string;
      target_price?: number;
      stop_loss?:    number;
      reasons?:      string[];
      thought?:      string;
      thoughts?:     string[];
      raw_response?: string;
    }
  | { status: 'error';     reason: string; thought?: string; thoughts?: string[]; raw_response?: string }
  | { status: 'uncertain'; reason: string; thought?: string; thoughts?: string[]; raw_response?: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 90_000;

const FALLBACK_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-5',
] as const;

const JSON_OUTPUT_RULES = [
  'OUTPUT JSON ONLY. No markdown, no commentary outside the JSON.',
  'Schema:',
  '{',
  '  "status": "ok|uncertain|error",',
  '  "prediction": "UP|DOWN|UNKNOWN",',
  '  "confidence": 0-100,',
  '  "strategy": "string (concrete tactical execution recommendation)",',
  '  "thesis": "string (deep multi-paragraph fundamental & market structure analysis explaining the vision, macro drivers, and catalyst roadmap)",',
  '  "target_price": number|null,',
  '  "stop_loss": number|null,',
  '  "reasons": ["string", ...] // 3-4 high-level strategic catalyst bullets (e.g. secular drivers, business moat, liquidity inflection)',
  '  "reason": "string" // required when status != ok',
  '}',
  'If data is insufficient, set status to "uncertain", prediction to "UNKNOWN", and explain in reason.',
].join('\n');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uncertain = (reason: string, raw?: string): AIResult => ({ status: 'uncertain', reason, thought: reason, thoughts: [reason], raw_response: raw });
const errResult = (reason: string, raw?: string): AIResult => ({ status: 'error',     reason, thought: reason, thoughts: [reason], raw_response: raw });

/** The system-level analysis preamble injected for all providers */
function buildSystemPrompt(): string {
  return (
    `You are a Lead Portfolio Manager and Senior Equity Strategist at a premier quantitative macro fund. ` +
    `Your goal is to deliver sharp, strategic, high-conviction market research and investment thesis.\n\n` +
    `ANALYTICAL DIRECTIVE:\n` +
    `1. STRATEGIC THESIS: Provide a rich, professional thesis explaining what is fundamentally and technically driving this asset. ` +
    `   Cover secular growth trends, business moat, revenue catalysts, institutional order flow, and macro cycle positioning.\n` +
    `2. CONVICTION & DIRECTIONAL STANCE: Synthesize technical levels, ATR volatility, and macro regime into a clear risk-managed game plan. Even when presenting dual Long and Short setups, clearly convey what the quantitative data intelligence indicates and which side has the statistical edge.\n` +
    `3. CATALYST DRIVERS (reasons): Do NOT merely repeat technical formulas (like "SMA20 is X"). Instead, distill the 3-4 decisive strategic reasons ` +
    `   (e.g., "Secular AI datacenter capital expenditure expansion", "Bullish momentum continuation above multi-month accumulation base", "Contrarian retail sentiment reset with institutional accumulation").\n` +
    `4. RUTHLESS OBJECTIVITY: Both bullish and bearish calls are equally respected. Always specify the primary invalidation risk.\n\n` +
    `ACCURACY CHECK (do before answering):\n` +
    `  - Ground all price levels to the provided dataset.\n` +
    `  - Ensure prediction, confidence, thesis, and trade levels form a unified narrative.\n` +
    `  - Keep tone highly professional, precise, and institutional.\n\n` +
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
      case 'custom':  return this.analyzeWithCustom(prompt);
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
    const systemPrompt  = buildSystemPrompt();
    const models         = buildWaterfall();
    const primary        = models[0];
    let   lastError      = '';

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: prompt },
    ];

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
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        maxTokens: 4096,
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

  // ─── Custom / 9router (OpenAI-compatible) ─────────────────────────────────

  private async analyzeWithCustom(prompt: string): Promise<AIResult> {
    const endpoint = config.custom.endpoint;
    const model = config.custom.model;
    if (!model) {
      log.warn('ai', 'No custom model set — pick one in Settings or Chat.');
      return uncertain('No custom model configured');
    }

    console.log('');
    log.ai('mode',     'Custom (9router / OpenAI-compatible)');
    log.ai('endpoint', clr.dim(endpoint));
    log.ai('model',    clr.white(model));
    log.ai('timeout',  clr.dim((TIMEOUT_MS / 1000) + 's'));

    try {
      const content = await this.llm.callText({
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        maxTokens: 4096,
        responseFormat: 'json',
      });

      const parsed = this.validateResponse(content);
      if (parsed.ok) {
        if (parsed.warnings.length > 0) {
          parsed.warnings.forEach(w => log.warn('ai', w));
        }
        return parsed.result;
      }

      log.error('ai', `Invalid JSON from custom provider: ${parsed.error}`);
      return uncertain('Custom provider response failed schema validation');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ai', `Custom provider error: ${msg}`);
      return errResult(`Custom provider API call failed: ${msg}`);
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
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: prompt }
        ],
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

    // ── Sanitize NVIDIA NIM quirks before AJV validation ──────────────────────
    // Nemotron and other NIM reasoning models return non-standard field values.
    if (parsed !== null && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;

      // 1. Coerce `status` — model may return 'success', 'good', 'warning', etc.
      if (typeof p.status === 'string') {
        const s = p.status.toLowerCase().trim();
        if (['ok', 'success', 'good', 'valid'].includes(s))        p.status = 'ok';
        else if (['uncertain', 'warning', 'partial', 'unknown'].includes(s)) p.status = 'uncertain';
        else if (!['ok', 'uncertain', 'error'].includes(s))        p.status = 'error';
      }

      // 2. Coerce `prediction` — model may return 'BULLISH', 'BEARISH', 'NEUTRAL', etc.
      if (typeof p.prediction === 'string') {
        const pr = p.prediction.toUpperCase().trim();
        if (['UP', 'BULLISH', 'LONG', 'BUY'].includes(pr))          p.prediction = 'UP';
        else if (['DOWN', 'BEARISH', 'SHORT', 'SELL'].includes(pr)) p.prediction = 'DOWN';
        else                                                          p.prediction = 'UNKNOWN';
      }

      // 3. Coerce `reasons` — model may emit null/numeric items.
      if (Array.isArray(p.reasons)) {
        p.reasons = (p.reasons as unknown[])
          .filter((r) => r !== null && r !== undefined)
          .map((r) => (typeof r === 'string' ? r : String(r)))
          .filter((r) => (r as string).trim().length > 0);
      }

      // 4. If status is ok but prediction is missing, try to recover it from other fields
      //    before demoting — Nemotron sometimes omits prediction when token budget is tight.
      if (p.status === 'ok' && !p.prediction) {
        // Try to infer prediction from strategy or reasons text
        const textHints = [
          typeof p.strategy === 'string' ? p.strategy : '',
          ...(Array.isArray(p.reasons) ? (p.reasons as string[]) : []),
        ].join(' ').toUpperCase();
        if (/\bBULL|\bLONG|\bUPSIDE|\bBUY/.test(textHints))       p.prediction = 'UP';
        else if (/\bBEAR|\bSHORT|\bDOWNSIDE|\bSELL/.test(textHints)) p.prediction = 'DOWN';
        else {
          // Cannot infer — demote to uncertain with a meaningful reason
          p.status = 'uncertain';
          p.reason = typeof p.strategy === 'string' && p.strategy.trim()
            ? p.strategy.trim()
            : 'Model did not provide a prediction';
        }
      }

      // 5. Coerce `reason` to string if it exists but is not a string
      if (p.reason !== undefined && typeof p.reason !== 'string') {
        if (Array.isArray(p.reason)) p.reason = p.reason.map(r => String(r)).join('; ');
        else if (p.reason === null) delete p.reason;
        else p.reason = String(p.reason);
      }

      // 6. If status is error/uncertain but reason is missing, pull from reasons[] or strategy.
      if ((p.status === 'error' || p.status === 'uncertain') && !p.reason) {
        const fallbackReason =
          (Array.isArray(p.reasons) && (p.reasons as string[]).length > 0)
            ? (p.reasons as string[])[0]
            : typeof p.strategy === 'string' && p.strategy.trim()
            ? p.strategy.trim()
            : 'Model returned no reason';
        p.reason = fallbackReason;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const valid = validateAiPrediction(parsed);
    if (!valid) {
      const errors = formatSchemaErrors(validateAiPrediction.errors).join('; ');
      return { ok: false, error: errors || 'Schema validation failed', warnings: extracted.warnings };
    }

    const result = this.normalizeResult(parsed as AIPredictionPayload, extracted.jsonText);
    return { ok: true, result, warnings: extracted.warnings };
  }

  private normalizeResult(payload: AIPredictionPayload, raw: string): AIResult {
    // Extract raw thinking tag if present
    let thoughtText = '';
    const thinkingMatch = raw.match(/<think(?:ing)?>(.*?)<\/think(?:ing)?>/s);
    if (thinkingMatch) {
      thoughtText = thinkingMatch[1].trim();
    }

    if (payload.status !== 'ok') {
      const reason = payload.reason ?? 'Model returned no reason';
      return {
        status: payload.status,
        reason,
        thought: thoughtText || reason,
        thoughts: thoughtText ? [thoughtText] : [reason],
        raw_response: raw,
      };
    }

    const confidence = Math.max(0, Math.min(100, Math.round(payload.confidence ?? 50)));
    const reasons = payload.reasons?.filter(r => r.trim().length > 0).slice(0, 5);

    if (!thoughtText) {
      if (reasons && reasons.length > 0) {
        thoughtText = reasons.join('\n');
      } else if (payload.strategy) {
        thoughtText = payload.strategy;
      }
    }

    const thoughtsList = reasons && reasons.length > 0
      ? reasons
      : thoughtText ? [thoughtText] : undefined;

    return {
      status: 'ok',
      prediction: (payload.prediction ?? 'UNKNOWN') as 'UP' | 'DOWN' | 'UNKNOWN',
      confidence,
      strategy: payload.strategy?.trim() || undefined,
      target_price: payload.target_price ?? undefined,
      stop_loss: payload.stop_loss ?? undefined,
      reasons: reasons && reasons.length > 0 ? reasons : undefined,
      thought: thoughtText || undefined,
      thoughts: thoughtsList,
      raw_response: raw,
    };
  }

  public parseResponse(content: string): AIResult {
    const parsed = this.validateResponse(content);
    if (parsed.ok) return parsed.result;
    return uncertain(`Invalid JSON response: ${parsed.error}`, content);
  }
}
