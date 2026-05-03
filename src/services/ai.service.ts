import { config } from '../config/config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIResultStatus = "ok" | "error" | "uncertain";

export interface AIResult {
  status: AIResultStatus;
  prediction?: "UP" | "DOWN" | "UNKNOWN";
  confidence?: number;
  strategy?: string;
  target_price?: number;
  stop_loss?: number;
  raw_response?: string;
  reason?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 90_000;

// Static fallback chain — used AFTER the user's chosen model.
// These are never the primary; they only kick in on 429/timeout/error.
const FALLBACK_MODELS = [
  'openai/gpt-5',
  'openai/gpt-4o-mini',
] as const;

const RESPONSE_PATTERN =
  /PREDICTION:\s*(UP|DOWN).*?CONFIDENCE:\s*(\d+).*?STRATEGY:\s*([^\n]+).*?TARGET:\s*\$?([\d,]+\.?\d*).*?STOP:\s*\$?([\d,]+\.?\d*)/is;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uncertain = (reason: string): AIResult => ({ status: "uncertain", reason });
const errResult = (reason: string): AIResult => ({ status: "error",     reason });

// Build the waterfall at call time so config.aiModel reflects the user's
// selection from the startup wizard (module-level const would freeze it too early).
function buildWaterfall(): string[] {
  const primary = config.aiModel;
  const seen    = new Set<string>([primary]);
  const tail    = FALLBACK_MODELS.filter((m) => !seen.has(m));
  return [primary, ...tail];
}

// ─── AIService ────────────────────────────────────────────────────────────────

export class AIService {
  analyze(prompt: string): Promise<AIResult> {
    return config.aiProvider === "offline"
      ? this.analyzeWithOffline(prompt)
      : this.analyzeWithGitHub(prompt);
  }

  // ─── GitHub Models via native fetch ───────────────────────────────────────
  //
  // Tries each model in the waterfall in order.
  // On 429 / timeout it moves to the next model immediately —
  // different models have independent quotas.

  private async analyzeWithGitHub(prompt: string): Promise<AIResult> {
    const token = config.github.token;
    if (!token) {
      console.warn("[AI] Cannot run AI analysis without GITHUB_TOKEN.");
      return uncertain("No API token");
    }

    const endpoint = `${config.github.endpoint}/chat/completions`;

    const combinedPrompt =
      `You are a senior NVDA stock analyst at a top hedge fund with expertise ` +
      `in technical analysis, crowd psychology, and cross-asset reasoning.\n\n` +
      `REASONING FRAMEWORK:\n` +
      `1. TECHNICAL SIGNALS: Weight validated patterns, volume, multi-timeframe confluence\n` +
      `2. CROWD PSYCHOLOGY: Use sentiment as contrarian indicator when extreme (>70% one way)\n` +
      `3. MACRO CONTEXT: Consider SPY/QQQ/tech sector correlation strength\n` +
      `4. CROSS-VALIDATION: Bull case requires 3+ confirming signals; otherwise reduce confidence\n` +
      `5. TIMING: If move already extended, lower confidence and tighten stops\n\n` +
      prompt;

    // Waterfall is built here — after the wizard has mutated config.aiModel
    const models   = buildWaterfall();
    const primary  = models[0];
    let lastError  = "";

    for (const model of models) {
      const isFallback = model !== primary;
      console.log(`\n[AI] ${isFallback ? 'Fallback' : 'Trying'} model: ${model}`);
      console.log(`[AI] Endpoint: ${endpoint}`);
      console.log(`[AI] Timeout: ${TIMEOUT_MS / 1000}s`);
      console.log("-".repeat(80));

      const result = await this.callOnce(endpoint, token, model, combinedPrompt);

      if (result.type === "ok") {
        if (isFallback) {
          console.log(`[AI] Success via fallback model: ${model}`);
        }
        return this.parseResponse(result.content);
      }

      if (result.type === "rate_limit") {
        console.warn(`[AI] ${model} rate limited (429) — trying next model...`);
        lastError = `${model}: rate limited`;
        continue;
      }

      if (result.type === "timeout") {
        console.warn(`[AI] ${model} timed out — trying next model...`);
        lastError = `${model}: timeout`;
        continue;
      }

      console.error(`[AI] ${model} error: ${result.message}`);
      lastError = `${model}: ${result.message}`;

      if (result.type === "auth_error") {
        console.error("[AI] Token rejected — stopping fallback chain.");
        break;
      }
    }

    console.error(`[AI] All models exhausted. Last error: ${lastError}`);
    return errResult("All models failed");
  }

  // ─── Single attempt ───────────────────────────────────────────────────────

  private async callOnce(
    endpoint: string,
    token:    string,
    model:    string,
    prompt:   string,
  ): Promise<
    | { type: "ok";         content: string }
    | { type: "rate_limit" }
    | { type: "timeout" }
    | { type: "auth_error"; message: string }
    | { type: "error";      message: string }
  > {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          max_tokens:  4000,
          temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 429) return { type: "rate_limit" };
      if (res.status === 401 || res.status === 403) {
        return { type: "auth_error", message: `HTTP ${res.status} Unauthorized` };
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { type: "error", message: `HTTP ${res.status}: ${body.slice(0, 120)}` };
      }

      const json = await res.json() as any;
      let content: string = json.choices?.[0]?.message?.content ?? "";

      if (!content) return { type: "error", message: "Empty content in response" };

      console.log(`[AI] Response received — ${content.length} chars`);

      // DeepSeek R1 wraps reasoning in <think> tags — strip it
      if (content.includes("</think>")) {
        content = content.split("</think>").pop()!.trim();
        console.log("[AI] Stripped <think> block");
      }

      return { type: "ok", content };

    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") return { type: "timeout" };
      return { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── Offline / Ollama ─────────────────────────────────────────────────────

  private async analyzeWithOffline(prompt: string): Promise<AIResult> {
    const endpoint = config.aiEndpoint?.replace(/\/$/, "");
    if (!endpoint) {
      console.warn("[AI] Cannot run offline analysis without OFFLINE_AI_URL.");
      return uncertain("No offline endpoint");
    }

    console.log("\n[AI] Consulting offline AI (Ollama-compatible)...\n");
    console.log(`[AI] Endpoint: ${endpoint}`);
    console.log(`[AI] Model: ${config.aiModel}`);

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${endpoint}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:    config.aiModel,
          messages: [{ role: "user", content: prompt }],
          stream:   false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data    = await res.json() as any;
      const content = (data?.message?.content ?? data?.response ?? "") as string;

      if (!content) return errResult("Empty response from offline AI");
      return this.parseResponse(content);

    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AI] Offline error: ${msg}`);
      return errResult("Offline API call failed");
    }
  }

  // ─── Response Parsing ─────────────────────────────────────────────────────

  private parseResponse(content: string): AIResult {
    const match = content.match(RESPONSE_PATTERN);

    if (match) {
      console.log("[AI] Successfully parsed structured prediction.");
      return {
        status:       "ok",
        prediction:   match[1].toUpperCase() as "UP" | "DOWN",
        confidence:   parseInt(match[2], 10),
        strategy:     match[3].trim(),
        target_price: parseFloat(match[4].replace(/,/g, "")),
        stop_loss:    parseFloat(match[5].replace(/,/g, "")),
        raw_response: content,
      };
    }

    console.warn("[AI] No structured prediction found — returning raw response.");
    return {
      status:       "ok",
      prediction:   "UNKNOWN",
      confidence:   50,
      raw_response: content,
    };
  }
}