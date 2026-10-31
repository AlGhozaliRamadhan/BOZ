// ─── shared/tool-retry.ts ────────────────────────────────────────────────────
// Transient-failure retry for network tool calls (Yahoo, news, search, proxy
// endpoints). A flaky upstream used to surface as one failed observation and a
// "silent failure" in the timeline, when the same request succeeds a second
// later. The runner re-issues the call over a fixed 1s/2s/4s backoff and
// announces each retry BEFORE the wait begins, so a viewer watching the panel
// sees "Retrying VOO dashboard (2/3)…" rather than a stall.
//
// What is deliberately NOT retried: permanent failures. An invalid ticker, an
// auth rejection, or a "no news found" verdict will not get better on attempt
// two — retrying those wasted up to 7 seconds and made the failure look
// transient when it needed a symbol resolution instead.
//
// Pure module: no imports, no config, safe for API routes and client code.

/** Why a failure was judged retryable. Surfaced to the panel as a short code. */
export type ToolFailureCode =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'empty';

/** A retry that is about to happen, announced before its backoff wait. */
export interface ToolRetryNotice {
  tool: string;
  args: Record<string, unknown>;
  /** Which retry is starting: 1 for the first, up to `allowance`. */
  attempt: number;
  allowance: number;
  code: ToolFailureCode;
}

/** Backoff before each retry: ~1s, ~2s, ~4s. */
export const TOOL_RETRY_DELAYS_MS: Readonly<number[]> = [1_000, 2_000, 4_000];

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function firstNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Classifies a thrown tool failure.
 *
 * Returns the failure's code when a retry has a realistic chance of helping,
 * and `null` when it does not: aborts, auth, invalid input and client errors
 * are permanent by construction. Status is read from both the axios-style
 * `response.status` shape and bare `err.status` / `statusCode`, because the
 * network services behind the tools do not agree on one.
 */
export function isTransientToolError(error: unknown): ToolFailureCode | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error && error.name === 'AbortError') return null;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return null;

  const err = error as {
    response?: { status?: unknown };
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status = firstNumber(err.response?.status, err.status, err.statusCode);
  if (status !== null) {
    if (status === 429) return 'rate_limited';
    if (status === 408) return 'timeout';
    if (status >= 500 && status < 600) return 'server_error';
    // Other 4xx: bad symbol, bad key, bad request — none improve on retry.
    return null;
  }

  const code = typeof err.code === 'string' ? err.code : '';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout';
  if (NETWORK_CODES.has(code)) return 'network';

  const message = typeof err.message === 'string' ? err.message : '';
  if (/rate limit|too many requests/i.test(message)) return 'rate_limited';
  // Gateway/server phrases are checked BEFORE the bare "timeout" pattern so
  // a "gateway timeout" (a 504, a server problem) does not masquerade as a
  // client-side transport timeout between two otherwise-equivalent codes.
  if (/service unavailable|bad gateway|gateway timeout|internal server error|overloaded/i.test(message)) return 'server_error';
  if (/timed?\s*out/i.test(message)) return 'timeout';
  if (/fetch failed|socket hang up|network|connection/i.test(message)) return 'network';
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ToolRetryOptions {
  /** Who is calling — carried on the notice so the panel can name it. */
  tool: string;
  args?: Record<string, unknown>;
  run: () => Promise<string>;
  /** Retries allowed after the first failure. Default 3. */
  maxRetries?: number;
  /** Wait before each retry; entry i precedes retry i+1. */
  delaysMs?: Readonly<number[]>;
  /** Called synchronously BEFORE each backoff wait begins. */
  onRetry?: (notice: ToolRetryNotice) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs one tool call and re-issues it while the failure looks transient.
 *
 * Two transient shapes are handled the same way: a thrown error classified by
 * `isTransientToolError`, and an observation that came back literally empty
 * (an upstream that swallowed its own exception). An observation is returned
 * untouched in every other case — including "no results" verdicts, which are
 * data answers rather than transport failures and must be retried never.
 */
export async function runToolWithRetries({
  tool,
  args = {},
  run,
  maxRetries = 3,
  delaysMs = TOOL_RETRY_DELAYS_MS,
  onRetry,
  sleep = defaultSleep,
}: ToolRetryOptions): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let observation = '';
    try {
      observation = String((await run()) ?? '');
    } catch (error) {
      const code = isTransientToolError(error);
      // `null` means permanent (or an abort): hand the failure straight up so
      // the engine states it honestly instead of circling the same rejection.
      if (code === null || attempt >= maxRetries) throw error;
      const delayMs = delaysMs[attempt] ?? delaysMs[delaysMs.length - 1] ?? 0;
      onRetry?.({ tool, args, attempt: attempt + 1, allowance: maxRetries, code });
      await sleep(delayMs);
      continue;
    }

    if (observation.trim() === '' && attempt < maxRetries) {
      const delayMs = delaysMs[attempt] ?? delaysMs[delaysMs.length - 1] ?? 0;
      onRetry?.({ tool, args, attempt: attempt + 1, allowance: maxRetries, code: 'empty' });
      await sleep(delayMs);
      continue;
    }
    return observation;
  }
}
