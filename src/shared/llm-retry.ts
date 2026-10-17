// ─── shared/llm-retry.ts ─────────────────────────────────────────────────────
// Provider-request retry for the chat agent.
//
// One rule shapes this module: a retry is *announced before it waits*. The
// caller learns a retry is scheduled (so the UI can show it and the user can
// Stop mid-wait) and only then does any timer start. A crash or cancel can
// therefore never leave an invisible pending retry.
//
// Three deliberate limits:
//   • Retries re-run the failed PASS, never the stream. Already-yielded
//     tokens stay in the reader's hands; a failed attempt's partial text is
//     the caller's to keep or discard (see `collectThinkingPass` vs
//     `streamContinuation` in chat.engine.ts).
//   • Every retry is another billed provider request. `perGenerationBudget`
//     caps the whole generation so a flapping provider cannot multiply spend.
//   • `Retry-After` is clamped to `maxDelayMs` rather than obeyed literally:
//     a provider asking for 5 minutes must not freeze a desktop app for 5
//     minutes. When it is clamped the attempt budget is extended instead, so
//     a long explicit backoff turns into "wait longer, then really try".
//
// Pure module: no `use client`, no DOM globals beyond AbortSignal/DOMException,
// no imports — safe to use from the API route, the SSE client, and tests.

// ─── Failure taxonomy ────────────────────────────────────────────────────────

export type LlmFailureCode =
  /** Provider asked us to slow down (429, overloaded). */
  | 'RATE_LIMIT'
  /** 5xx, or a provider-side fault with no status. */
  | 'SERVER'
  /** The request or the wait ran out of time. */
  | 'TIMEOUT'
  /** Socket/DNS/connect failure — the request never reached a handler. */
  | 'TRANSPORT'
  /** The request succeeded but produced no usable content. */
  | 'EMPTY_RESPONSE'
  /** Credentials rejected (401/403). Never retried: the key is wrong. */
  | 'AUTH'
  /** Account/credit exhausted (402). Never retried: the wallet is empty. */
  | 'QUOTA'
  /** Malformed request (400/413). Never retried: it will fail identically. */
  | 'INVALID_REQUEST'
  /** The prompt does not fit the model's context window. */
  | 'CONTEXT_WINDOW_EXCEEDED'
  /** BOZ's own per-request ceilings (LLM calls, tool rounds). */
  | 'EXECUTION_LIMIT'
  /** Anything we could not confidently classify. */
  | 'UNKNOWN';

/** Provider-neutral facts about one failed model request. */
export interface LlmFailure {
  readonly code: LlmFailureCode;
  /** Redaction-safe message. Never include provider response bodies verbatim. */
  readonly message: string;
  /** HTTP status when the failure came from a response, not a throw. */
  readonly status?: number;
  /** Provider-supplied wait in ms, from `Retry-After`. Already validated. */
  readonly retryAfterMs?: number;
  /** Provider request id, useful when the user files a support ticket. */
  readonly requestId?: number | string;
  /** True when the value is a user/teardown abort, never a provider fault. */
  readonly aborted?: boolean;
}

/** Codes that are worth another request. Everything else ends the turn. */
const DEFAULT_RETRYABLE_CODES: readonly LlmFailureCode[] = Object.freeze([
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
  'EMPTY_RESPONSE',
]);

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Read a property without letting a hostile accessor replace the primary
 * failure.
 *
 * An own ACCESSOR property is treated as absent: falling back to `value[key]`
 * would invoke it, letting a crafted error object choose its own retry
 * verdict or smuggle text past the redaction boundary. Only an inherited value
 * (no own descriptor at all) justifies a guarded plain read, which is what
 * keeps this working on SDK error classes.
 */
function safeProp(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined) {
      return 'value' in descriptor ? descriptor.value : undefined;
    }
  } catch {
    // Trapped descriptor lookup — fall through to the guarded read.
  }
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readString(value: unknown, key: string): string | undefined {
  const raw = safeProp(value, key);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** HTTP status from any shape: `.status`, or axios's nested `.response.status`. */
function readStatus(value: unknown): number | undefined {
  const candidates = [safeProp(value, 'status'), safeProp(safeProp(value, 'response'), 'status')];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return candidate;
    }
  }
  return undefined;
}

/** Response headers from `Headers`, a plain object, or an axios header bag. */
function readHeaders(value: unknown): unknown {
  return safeProp(value, 'headers') ?? safeProp(safeProp(value, 'response'), 'headers');
}

/** Case-insensitive header read across Headers / plain object / string[]. */
function readHeader(headers: unknown, name: string): string | undefined {
  if (headers === null || typeof headers !== 'object') return undefined;
  const getter = safeProp(headers, 'get');
  if (typeof getter === 'function') {
    try {
      const value = (getter as (key: string) => unknown).call(headers, name);
      if (typeof value === 'string' && value.length > 0) return value;
    } catch {
      // Fall through to the key scan below.
    }
  }
  const target = name.toLowerCase();
  try {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() !== target) continue;
      if (typeof value === 'string' && value.length > 0) return value;
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0];
    }
  } catch {
    // Hostile headers object — treat the header as absent.
  }
  return undefined;
}

/**
 * Parse `Retry-After` in either legal form: delta-seconds, or an HTTP-date.
 * Zero, past, malformed, and non-numeric values are treated as absent so a
 * broken header can never schedule a zero-length busy loop.
 *
 * @param headers - `Headers`, a plain header object, or an axios header bag.
 * @param now - injected clock for tests.
 */
export function parseLlmRetryAfterMs(headers: unknown, now: number = Date.now()): number | undefined {
  const raw = readHeader(headers, 'retry-after');
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return undefined;
  const ms = at - now;
  return ms > 0 ? ms : undefined;
}

/** Socket-level codes every provider transport funnels through. */
const TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND',
  'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
]);

/**
 * Fatal message signatures, checked BEFORE the transient ones. A provider
 * that says "maximum context length" inside a 400 is a context problem, not a
 * transient one, and the ordering here is what keeps that true.
 */
const FATAL_MESSAGE_PATTERNS: ReadonlyArray<readonly [RegExp, LlmFailureCode]> = [
  [/maximum context|context length|context window|too many tokens|prompt is too long|string too long/i, 'CONTEXT_WINDOW_EXCEEDED'],
  [/insufficient[_ ]?(credit|quota|balance)|billing|out of credits|payment required/i, 'QUOTA'],
  [/unauthori[sz]ed|forbidden|invalid[_ ]?api[_ ]?key|incorrect[_ ]?api[_ ]?key|authentication|permission denied|api[_ ]?key.*missing/i, 'AUTH'],
  [/execution limit|budget exceeded|max(?:imum)? (?:tool|l[lm]|sub-?agent|deep-?scan)|call budget/i, 'EXECUTION_LIMIT'],
];

const TRANSIENT_MESSAGE_PATTERNS: ReadonlyArray<readonly [RegExp, LlmFailureCode]> = [
  [/rate.?limit|too many requests|concurrency limit|overloaded|capacity|try again later/i, 'RATE_LIMIT'],
  [/deadline exceeded|timed out|timeout/i, 'TIMEOUT'],
  [/service unavailable|bad gateway|gateway timeout|upstream|internal server|server error|temporarily unavailable|fetch failed|network|socket hang up|connection (?:reset|closed|refused|aborted)|terminated|econnreset|enoent/i, 'TRANSPORT'],
];

/** `error.type` / `error.code` hints some providers send in the JSON body. */
function classifyFromHint(hint: string): LlmFailureCode | undefined {
  const value = hint.toLowerCase();
  if (value.includes('authentication') || value.includes('permission')) return 'AUTH';
  if (value.includes('quota') || value.includes('billing')) return 'QUOTA';
  if (value.includes('rate_limit') || value.includes('rate limit')) return 'RATE_LIMIT';
  if (value.includes('overload')) return 'RATE_LIMIT';
  if (value.includes('context') || value.includes('too_long')) return 'CONTEXT_WINDOW_EXCEEDED';
  if (value.includes('invalid_request') || value.includes('invalid_request_error')) return 'INVALID_REQUEST';
  if (value.includes('api_error') || value.includes('server_error')) return 'SERVER';
  if (value.includes('timeout')) return 'TIMEOUT';
  return undefined;
}

/** Validate a carried `LlmFailure` snapshot before trusting a foreign one. */
function failureSnapshot(value: unknown): LlmFailure | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<LlmFailure>;
  const code = candidate.code;
  const message = candidate.message;
  if (typeof code !== 'string' || !KNOWN_FAILURE_CODES.has(code as LlmFailureCode)) return undefined;
  if (typeof message !== 'string' || message.length === 0) return undefined;
  const status = candidate.status;
  const retryAfterMs = candidate.retryAfterMs;
  if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) return undefined;
  if (retryAfterMs !== undefined && (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0)) return undefined;
  return Object.freeze({
    code: code as LlmFailureCode,
    message,
    ...status === undefined ? {} : { status: status as number },
    ...retryAfterMs === undefined ? {} : { retryAfterMs: retryAfterMs as number },
    ...candidate.requestId === undefined ? {} : { requestId: candidate.requestId },
    ...candidate.aborted === true ? { aborted: true } : {},
  });
}

const KNOWN_FAILURE_CODES: ReadonlySet<string> = new Set<LlmFailureCode>([
  'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE',
  'AUTH', 'QUOTA', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED',
  'EXECUTION_LIMIT', 'UNKNOWN',
]);

/** True for a user cancel or teardown, which is never a provider fault. */
export function isLlmAbortError(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (safeProp(value, 'name') === 'AbortError') return true;
  const code = safeProp(value, 'code');
  return code === 'ABORT_ERR';
}

/** BOZ's own sentinel for "the request worked but said nothing". */
export function isEmptyResponseSentinel(value: unknown): boolean {
  const code = safeProp(value, 'code');
  return code === 'EMPTY_PASS' || code === 'EMPTY_CONTINUATION' || code === 'EMPTY_RESPONSE';
}

/**
 * Collapse anything a provider transport can throw into one `LlmFailure`.
 *
 * Handles the OpenAI SDK (`.status` + `.headers` + `.error.type`), axios
 * (`.response.status` + `.response.headers`), raw `fetch` (our own
 * `LlmFailureError`), Node socket errors (`.code`), and bare objects, without
 * any of them having been adapted at their own call site.
 *
 * @param value - the thrown value, whatever its shape.
 * @returns immutable, redacted facts safe to log and to decide retries on.
 */
export function normalizeLlmFailure(value: unknown): LlmFailure {
  // 1. Our own error, or a cross-realm copy carrying the same snapshot.
  const carried = value instanceof LlmFailureError
    ? value.failure
    : failureSnapshot(safeProp(value, 'failure'));
  if (carried !== undefined) return carried;

  // 2. BOZ's own "the stream came back empty" sentinel.
  if (isEmptyResponseSentinel(value)) {
    return Object.freeze({ code: 'EMPTY_RESPONSE', message: 'The model returned an empty response.' });
  }

  // 3. Abort. Distinguished from every provider fault so a Stop is never
  //    mistaken for a rate limit.
  if (isLlmAbortError(value)) {
    return Object.freeze({ code: 'UNKNOWN', message: 'The request was cancelled.', aborted: true });
  }

  // Read the message from the thrown VALUE, not from a synthesized Error:
  // adapters and tests routinely throw `{ message: 'fetch failed' }`, and
  // `String(plainObject)` would erase exactly the text the classifiers read.
  const message = readString(value, 'message') ?? readString(value, 'error')
    ?? (typeof value === 'string' ? value : undefined)
    ?? stringifyThrown(value);
  const status = readStatus(value);
  const headers = readHeaders(value);

  // 4. Socket-level transport failures, before any HTTP interpretation.
  const syscallCode = readString(value, 'code');
  if (syscallCode !== undefined && TRANSPORT_CODES.has(syscallCode.toUpperCase())) {
    return Object.freeze({
      code: syscallCode.toUpperCase() === 'ETIMEDOUT' ? 'TIMEOUT' : 'TRANSPORT',
      message,
      ...status === undefined ? {} : { status },
    });
  }

  const retryAfterMs = parseLlmRetryAfterMs(headers);
  const requestId = readHeader(headers, 'request-id') ?? readHeader(headers, 'x-request-id');
  const body = safeProp(value, 'error');
  const hint = typeof body === 'object' && body !== null
    ? `${readString(body, 'type') ?? ''} ${readString(body, 'code') ?? ''}`
    : '';

  const code = classifyLlmFailure(status, hint, message);
  return Object.freeze({
    code,
    message,
    ...status === undefined ? {} : { status },
    ...retryAfterMs === undefined ? {} : { retryAfterMs },
    ...requestId === undefined ? {} : { requestId },
  });
}

/** Rank the evidence: explicit status, then provider hint, then message text. */
function classifyLlmFailure(status: number | undefined, hint: string, message: string): LlmFailureCode {
  if (status !== undefined) {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 402) return 'QUOTA';
    if (status === 429 || status === 529) return 'RATE_LIMIT';
    if (status === 408) return 'TIMEOUT';
    if (status === 413) return 'INVALID_REQUEST';
    if (status >= 500) return 'SERVER';
  }
  const hinted = classifyFromHint(hint);
  if (hinted !== undefined) return hinted;

  // A 400 is only invalid-request once nothing fatal reads louder.
  for (const [pattern, code] of FATAL_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  if (status !== undefined && (status === 400 || status === 422)) return 'INVALID_REQUEST';

  for (const [pattern, code] of TRANSIENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  if (status !== undefined) return status >= 500 ? 'SERVER' : 'UNKNOWN';
  return 'UNKNOWN';
}

/** Render a non-Error throw without letting hostile coercion escape. */
function stringifyThrown(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : String(value);
    return text.length > 0 ? text : 'The model request failed.';
  } catch {
    return 'The model request failed.';
  }
}

/** Throws when `value` is an abort; otherwise returns it unchanged. */
function rethrowIfAborted(value: unknown): void {
  if (isLlmAbortError(value)) throw value;
}

/** An error that already carries normalized, decision-ready facts. */
export class LlmFailureError extends Error {
  readonly failure: LlmFailure;

  constructor(failure: LlmFailure, cause?: unknown) {
    super(failure.message, cause === undefined ? undefined : { cause });
    this.name = 'LlmFailureError';
    this.failure = Object.freeze({ ...failure });
  }
}

/**
 * Build the error an HTTP provider path should throw on a non-OK response.
 *
 * Raw `fetch` does not throw on 4xx/5xx, so without this the status and the
 * `Retry-After` header are simply discarded — which is exactly the fact the
 * retry layer needs most.
 *
 * @param message - redacted, user-safe summary. Never a raw response body.
 * @param status - the HTTP status.
 * @param headers - the `Headers` object, for `Retry-After` and request id.
 */
export function llmHttpFailure(message: string, status: number, headers?: unknown): LlmFailureError {
  const retryAfterMs = parseLlmRetryAfterMs(headers);
  const requestId = readHeader(headers, 'request-id') ?? readHeader(headers, 'x-request-id');
  return new LlmFailureError(Object.freeze({
    code: classifyLlmFailure(status, '', message),
    message,
    status,
    ...retryAfterMs === undefined ? {} : { retryAfterMs },
    ...requestId === undefined ? {} : { requestId },
  }));
}

// ─── Policy ──────────────────────────────────────────────────────────────────

export interface LlmRetryPolicy {
  /** Retries allowed at one call site before the error propagates. */
  readonly maxRetries: number;
  /** Failure codes worth another request. */
  readonly retryableCodes: readonly LlmFailureCode[];
  /** First local exponential-backoff delay, in ms. */
  readonly initialDelayMs: number;
  /** Ceiling for any single wait, including an honoured `Retry-After`. */
  readonly maxDelayMs: number;
  /** Symmetric jitter around each local delay, 0..1. */
  readonly jitterRatio: number;
  /**
   * Extra attempts granted when the provider's `Retry-After` exceeded
   * `maxDelayMs` and we clamped it. An explicit long backoff means "keep
   * trying", not "give up" — the clamp bounds the wait, the bonus bounds the
   * cost.
   */
  readonly providerHintBonusRetries: number;
}

export interface LlmRetryPolicyOverrides {
  maxRetries?: number;
  retryableCodes?: readonly LlmFailureCode[];
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  providerHintBonusRetries?: number;
}

/**
 * Defaults deliberately match BOZ's pre-existing budgets (`PASS0_MAX_RETRIES`
 * was 2) while fixing the curve it used to run on: the old code slept a flat
 * `1500 * attempt` ms with no cap and no jitter, which is the worst possible
 * response to a 429.
 */
export const DEFAULT_LLM_RETRY_POLICY: LlmRetryPolicy = Object.freeze({
  maxRetries: 2,
  retryableCodes: DEFAULT_RETRYABLE_CODES,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.1,
  providerHintBonusRetries: 2,
});

function positiveInt(value: number | undefined, fallback: number, path: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a non-negative safe integer`);
  return value;
}

function positiveNumber(value: number | undefined, fallback: number, path: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${path} must be a positive finite number`);
  return value;
}

/** Validate, default, and freeze one retry policy. */
export function resolveLlmRetryPolicy(overrides: LlmRetryPolicyOverrides = {}): LlmRetryPolicy {
  const path = 'llmRetryPolicy';
  const initialDelayMs = positiveNumber(overrides.initialDelayMs, DEFAULT_LLM_RETRY_POLICY.initialDelayMs, `${path}.initialDelayMs`);
  const maxDelayMs = positiveNumber(overrides.maxDelayMs, DEFAULT_LLM_RETRY_POLICY.maxDelayMs, `${path}.maxDelayMs`);
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  }
  const jitterRatio = overrides.jitterRatio ?? DEFAULT_LLM_RETRY_POLICY.jitterRatio;
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`);
  }
  const retryableCodes = overrides.retryableCodes ?? DEFAULT_LLM_RETRY_POLICY.retryableCodes;
  if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
  if (retryableCodes.some((code) => !KNOWN_FAILURE_CODES.has(code))) {
    throw new Error(`${path}.retryableCodes contains an unknown failure code`);
  }
  return Object.freeze({
    maxRetries: positiveInt(overrides.maxRetries, DEFAULT_LLM_RETRY_POLICY.maxRetries, `${path}.maxRetries`),
    retryableCodes: Object.freeze([...retryableCodes]),
    initialDelayMs,
    maxDelayMs,
    jitterRatio,
    providerHintBonusRetries: positiveInt(
      overrides.providerHintBonusRetries,
      DEFAULT_LLM_RETRY_POLICY.providerHintBonusRetries,
      `${path}.providerHintBonusRetries`,
    ),
  });
}

// ─── Backoff ─────────────────────────────────────────────────────────────────

export interface LlmRetryDelay {
  /** Actual milliseconds to wait. Always ≤ `policy.maxDelayMs`. */
  readonly delayMs: number;
  /** True when the delay came from the provider's `Retry-After`. */
  readonly honoredRetryAfter: boolean;
  /** True when `Retry-After` exceeded the cap and we shortened it. */
  readonly clamped: boolean;
}

/**
 * Decide how long to wait before attempt `attempt + 1`.
 *
 * A valid `Retry-After` wins over local backoff, because the provider knows
 * its own quota. It is still clamped to `maxDelayMs` — a desktop app must not
 * sit silent for the minutes a large quota window implies — and the clamp is
 * reported so the caller can extend its budget in response.
 *
 * @param options.attempt - 1-based index of the attempt just failed.
 * @param options.random - injected in `[0, 1)` so tests are deterministic.
 */
export function computeLlmRetryDelay(options: {
  policy: LlmRetryPolicy;
  attempt: number;
  retryAfterMs?: number;
  random?: () => number;
}): LlmRetryDelay {
  const { policy, attempt, retryAfterMs } = options;
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs <= policy.maxDelayMs
      ? { delayMs: retryAfterMs, honoredRetryAfter: true, clamped: false }
      : { delayMs: policy.maxDelayMs, honoredRetryAfter: true, clamped: true };
  }
  const random = options.random ?? Math.random;
  // `2 ** 1024` is Infinity, and Math.min clamps it to maxDelayMs — the
  // exponent cap only keeps the intermediate from becoming NaN.
  const exponent = Math.min(Math.max(attempt, 1) - 1, 1024);
  const exponential = Math.min(policy.initialDelayMs * 2 ** exponent, policy.maxDelayMs);
  const jitter = 1 - policy.jitterRatio + 2 * policy.jitterRatio * random();
  return {
    delayMs: Math.min(Math.round(exponential * jitter), policy.maxDelayMs),
    honoredRetryAfter: false,
    clamped: false,
  };
}

/**
 * A wait that a Stop press can interrupt.
 *
 * The engine used to `await new Promise(r => setTimeout(r, 1500 * attempt))`,
 * which the user could not cancel: pressing Stop mid-backoff still waited out
 * the full sleep. Resolves `false` (do not retry) when aborted.
 */
export function cancellableLlmRetryDelay(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (delayMs <= 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(false);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ─── Generation-wide budget ──────────────────────────────────────────────────

/**
 * Ceiling shared by every retry site in one generation.
 *
 * Without this the budgets compose multiplicatively: `MAX_LLM_CALLS` is 18 and
 * each site may retry several times, so a provider flapping on 503 could bill
 * far more than any single budget implies. Each generation gets one counter,
 * and a retry anywhere in that generation spends from it.
 */
export interface LlmRetryBudget {
  readonly limit: number;
  remaining(): number;
  /** Consumes one retry; returns false when the generation ceiling is spent. */
  spend(): boolean;
}

export function createLlmRetryBudget(limit: number): LlmRetryBudget {
  const safeLimit = Number.isSafeInteger(limit) && limit >= 0 ? limit : 0;
  let remaining = safeLimit;
  return {
    limit: safeLimit,
    remaining: () => remaining,
    spend: () => {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  };
}

// ─── Retry controller ────────────────────────────────────────────────────────

export interface LlmRetryNotice {
  /** 1-based index of the retry about to happen. */
  readonly attempt: number;
  readonly delayMs: number;
  readonly failure: LlmFailure;
  readonly honoredRetryAfter: boolean;
  readonly clamped: boolean;
  /** Retries this call site may still make, including this one. */
  readonly allowance: number;
  /** Retries left in the shared generation budget after this one. */
  readonly budgetRemaining: number;
}

export interface LlmRetryController {
  /**
   * Decide what to do about a failure.
   *
   * Resolves `true` when the caller should run another attempt — having first
   * announced the wait through `onScheduled` and awaited it cancellably.
   * Resolves `false` for anything that must propagate unchanged.
   *
   * @throws The original error when retries are not warranted, and the abort
   *   itself when the caller was cancelled.
   */
  retryOrThrow(error: unknown): Promise<boolean>;
  /** Every retry this controller scheduled, oldest first. */
  readonly notices: readonly LlmRetryNotice[];
}

export interface LlmRetryOptions {
  policy: LlmRetryPolicy;
  signal?: AbortSignal;
  /** Shared across the generation. Omit for a single call site. */
  budget?: LlmRetryBudget;
  /** Injected in `[0, 1)` for deterministic tests. */
  random?: () => number;
  /**
   * Called with the scheduled wait BEFORE any timer starts. This is the
   * "announce before waiting" rule: the SSE `retry` event is emitted from
   * here, so a cancelled backoff was already visible to the user.
   */
  onScheduled?: (notice: LlmRetryNotice) => void;
}

/**
 * Build a controller for one retry site.
 *
 * The controller is the incremental form of the retry loop so it works from
 * inside an async generator as well as a plain promise — `streamContinuation`
 * yields SSE events between attempts, which a single `await` cannot express.
 */
export function createLlmRetryController(options: LlmRetryOptions): LlmRetryController {
  const { policy, signal, budget, onScheduled } = options;
  const random = options.random ?? Math.random;
  const notices: LlmRetryNotice[] = [];
  let attempt = 0;

  return {
    notices,
    async retryOrThrow(error: unknown): Promise<boolean> {
      rethrowIfAborted(error);
      const failure = normalizeLlmFailure(error);
      if (failure.aborted || !policy.retryableCodes.includes(failure.code)) return false;

      // A provider that asked for longer than we are willing to wait gets a
      // longer budget, not an earlier failure.
      const providerOverCap = failure.retryAfterMs !== undefined && failure.retryAfterMs > policy.maxDelayMs;
      const allowance = policy.maxRetries + (providerOverCap ? policy.providerHintBonusRetries : 0);
      if (attempt >= allowance) return false;
      if (budget !== undefined && !budget.spend()) return false;
      if (signal?.aborted) throw abortError();

      attempt += 1;
      const delay = computeLlmRetryDelay({
        policy,
        attempt,
        ...failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs },
        random,
      });
      const notice: LlmRetryNotice = {
        attempt,
        delayMs: delay.delayMs,
        failure,
        honoredRetryAfter: delay.honoredRetryAfter,
        clamped: delay.clamped,
        allowance,
        budgetRemaining: budget?.remaining() ?? 0,
      };
      notices.push(notice);
      onScheduled?.(notice);

      if (!await cancellableLlmRetryDelay(delay.delayMs, signal)) throw abortError();
      return true;
    },
  };
}

function abortError(): Error {
  return new DOMException('Chat generation aborted', 'AbortError');
}

/**
 * Run one retryable unit of work, re-running it on transient failures.
 *
 * Convenience wrapper over {@link createLlmRetryController} for the common
 * case where the work is a plain promise. Use the controller directly when the
 * unit yields to its caller between attempts.
 *
 * @throws The last failure, unchanged, once retries are exhausted.
 */
export async function withLlmRetry<T>(run: () => Promise<T>, options: LlmRetryOptions): Promise<T> {
  const controller = createLlmRetryController(options);
  for (;;) {
    try {
      return await run();
    } catch (error: unknown) {
      if (!await controller.retryOrThrow(error)) throw error;
    }
  }
}

/**
 * Legacy classifier kept for callers and tests that only need a boolean.
 *
 * @deprecated Prefer {@link normalizeLlmFailure} and check
 * `policy.retryableCodes` — the failure's `retryAfterMs` and code are needed
 * to make the actual retry decision.
 */
export function isRetryableLlmFailure(failure: LlmFailure, policy: LlmRetryPolicy = DEFAULT_LLM_RETRY_POLICY): boolean {
  if (failure.aborted) return false;
  return policy.retryableCodes.includes(failure.code);
}