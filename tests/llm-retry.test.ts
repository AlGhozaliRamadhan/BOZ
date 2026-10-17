import { describe, expect, it, vi } from 'vitest';
import {
  cancellableLlmRetryDelay,
  computeLlmRetryDelay,
  createLlmRetryBudget,
  createLlmRetryController,
  DEFAULT_LLM_RETRY_POLICY,
  isLlmAbortError,
  isRetryableLlmFailure,
  LlmFailureError,
  llmHttpFailure,
  normalizeLlmFailure,
  parseLlmRetryAfterMs,
  resolveLlmRetryPolicy,
  withLlmRetry,
} from '../src/shared/llm-retry';

// The retry layer decides whether a provider hiccup is worth another billed
// request, and how long to wait first. Both decisions were previously made by
// regex over a thrown string, with three separate guesses at the same event.

describe('normalizeLlmFailure', () => {
  it('reads a plain object with an axios-style nested status', () => {
    const failure = normalizeLlmFailure({ response: { status: 429 }, message: 'Too Many Requests' });
    expect(failure.code).toBe('RATE_LIMIT');
    expect(failure.status).toBe(429);
    expect(failure.message).toBe('Too Many Requests');
  });

  it('reads the OpenAI SDK error shape', () => {
    const error = Object.assign(new Error('Bad gateway'), {
      status: 502,
      headers: new Headers({ 'retry-after': '3', 'x-request-id': 'req-1' }),
      error: { type: 'api_error', message: 'upstream' },
    });
    const failure = normalizeLlmFailure(error);
    expect(failure.code).toBe('SERVER');
    expect(failure.retryAfterMs).toBe(3000);
    expect(failure.requestId).toBe('req-1');
  });

  it('classifies socket-level codes as transport, except ETIMEDOUT', () => {
    expect(normalizeLlmFailure({ code: 'ECONNRESET', message: 'read ECONNRESET' }).code).toBe('TRANSPORT');
    expect(normalizeLlmFailure({ code: 'ECONNREFUSED', message: 'refused' }).code).toBe('TRANSPORT');
    expect(normalizeLlmFailure({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }).code).toBe('TIMEOUT');
    expect(normalizeLlmFailure({ code: 'ENOTFOUND', message: 'dns' }).code).toBe('TRANSPORT');
  });

  it('never misreads an abort as a provider fault', () => {
    const failure = normalizeLlmFailure(new DOMException('aborted', 'AbortError'));
    expect(failure.aborted).toBe(true);
    expect(isRetryableLlmFailure(failure)).toBe(false);
    expect(isLlmAbortError({ code: 'ABORT_ERR' })).toBe(true);
  });

  it('treats a 429 carrying an auth-sounding message as a rate limit', () => {
    // Status wins: the transport genuinely got a 429.
    expect(normalizeLlmFailure({ status: 429, message: 'quota exceeded' }).code).toBe('RATE_LIMIT');
  });

  it('keeps fatal failures out of the retryable set', () => {
    expect(isRetryableLlmFailure(normalizeLlmFailure({ status: 401 }))).toBe(false);
    expect(isRetryableLlmFailure(normalizeLlmFailure({ status: 403 }))).toBe(false);
    expect(isRetryableLlmFailure(normalizeLlmFailure(new Error('This model maximum context length is 128000')))).toBe(false);
    expect(isRetryableLlmFailure(normalizeLlmFailure(new Error('LLM-call budget exceeded (18 per request)')))).toBe(false);
    expect(isRetryableLlmFailure(normalizeLlmFailure(new Error('Invalid API key')))).toBe(false);
  });

  it('returns UNKNOWN rather than throwing on junk input', () => {
    expect(normalizeLlmFailure(null).code).toBe('UNKNOWN');
    expect(normalizeLlmFailure(undefined).code).toBe('UNKNOWN');
    expect(normalizeLlmFailure('boom').code).toBe('UNKNOWN');
    expect(isRetryableLlmFailure(normalizeLlmFailure(null))).toBe(false);
  });

  it('recognizes the engine empty-response sentinel', () => {
    expect(normalizeLlmFailure({ code: 'EMPTY_PASS', message: 'no text' }).code).toBe('EMPTY_RESPONSE');
    expect(normalizeLlmFailure({ code: 'EMPTY_CONTINUATION', message: 'no text' }).code).toBe('EMPTY_RESPONSE');
    expect(isRetryableLlmFailure(normalizeLlmFailure({ code: 'EMPTY_PASS' }))).toBe(true);
  });

  it('trusts a validated carried snapshot and rejects an invalid one', () => {
    const carried = normalizeLlmFailure({ failure: { code: 'SERVER', message: 'boom', status: 500 } });
    expect(carried).toMatchObject({ code: 'SERVER', status: 500 });

    // An untrusted shape must not be able to smuggle in a retryable verdict.
    const forged = normalizeLlmFailure({ failure: { code: 'SERVER', message: '', status: 999 } });
    expect(forged.code).not.toBe('SERVER');
  });

  it('never lets an accessor choose the retry verdict', () => {
    // A crafted error object must not be able to promote itself into the
    // retryable set by defining a getter for `status`.
    const hostile: Record<string, unknown> = { message: 'totally fine' };
    Object.defineProperty(hostile, 'status', { get: () => 429 });
    expect(normalizeLlmFailure(hostile).code).not.toBe('RATE_LIMIT');
    expect(isRetryableLlmFailure(normalizeLlmFailure(hostile))).toBe(false);
  });

  it('round-trips its own error type without re-deriving anything', () => {
    const original = llmHttpFailure('Anthropic returned HTTP 429', 429, new Headers({ 'retry-after': '2' }));
    expect(original).toBeInstanceOf(LlmFailureError);
    const failure = normalizeLlmFailure(original);
    expect(failure).toEqual(original.failure);
    expect(failure.retryAfterMs).toBe(2000);
  });
});

describe('llmHttpFailure', () => {
  it('preserves the status and Retry-After a raw fetch response carried', () => {
    // The bug this exists for: `new Error("HTTP 429")` discarded both.
    const error = llmHttpFailure('Anthropic returned HTTP 429', 429, new Headers({ 'retry-after': '7' }));
    expect(error.failure.status).toBe(429);
    expect(error.failure.retryAfterMs).toBe(7000);
    expect(error.failure.code).toBe('RATE_LIMIT');
  });

  it('classifies auth and server statuses', () => {
    expect(llmHttpFailure('Anthropic returned HTTP 401', 401).failure.code).toBe('AUTH');
    expect(llmHttpFailure('Anthropic returned HTTP 503', 503).failure.code).toBe('SERVER');
  });
});

describe('parseLlmRetryAfterMs', () => {
  it('accepts delta-seconds and an HTTP-date in the future', () => {
    expect(parseLlmRetryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseLlmRetryAfterMs(new Headers({ 'retry-after': 'Wed, 01 Jan 2026 00:00:05 GMT' }), now)).toBe(5000);
  });

  it('ignores zero, past, and malformed values', () => {
    // A zero-length busy loop would be worse than no retry at all.
    expect(parseLlmRetryAfterMs(new Headers({ 'retry-after': '0' }))).toBeUndefined();
    expect(parseLlmRetryAfterMs(new Headers({ 'retry-after': 'invalid' }))).toBeUndefined();
    expect(parseLlmRetryAfterMs(new Headers({ 'retry-after': '' }))).toBeUndefined();
    const now = Date.parse('2026-01-01T00:01:00Z');
    expect(parseLlmRetryAfterMs(new Headers({ 'retry-after': 'Wed, 01 Jan 2026 00:00:00 GMT' }), now)).toBeUndefined();
  });

  it('reads a plain header object case-insensitively', () => {
    expect(parseLlmRetryAfterMs({ 'Retry-After': '4' })).toBe(4000);
    expect(parseLlmRetryAfterMs(undefined)).toBeUndefined();
  });
});

describe('computeLlmRetryDelay', () => {
  const policy = resolveLlmRetryPolicy({ initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 });

  it('grows exponentially and stops at the cap', () => {
    expect(computeLlmRetryDelay({ policy, attempt: 1 }).delayMs).toBe(100);
    expect(computeLlmRetryDelay({ policy, attempt: 2 }).delayMs).toBe(200);
    expect(computeLlmRetryDelay({ policy, attempt: 3 }).delayMs).toBe(400);
    expect(computeLlmRetryDelay({ policy, attempt: 50 }).delayMs).toBe(1000);
  });

  it('applies symmetric jitter within the configured ratio', () => {
    const jittered = resolveLlmRetryPolicy({ initialDelayMs: 100, maxDelayMs: 10_000, jitterRatio: 0.5 });
    expect(computeLlmRetryDelay({ policy: jittered, attempt: 1, random: () => 0 }).delayMs).toBe(50);
    expect(computeLlmRetryDelay({ policy: jittered, attempt: 1, random: () => 1 }).delayMs).toBe(150);
  });

  it('prefers the provider Retry-After over local backoff', () => {
    const delay = computeLlmRetryDelay({ policy, attempt: 3, retryAfterMs: 750 });
    expect(delay).toMatchObject({ delayMs: 750, honoredRetryAfter: true, clamped: false });
  });

  it('clamps an over-cap Retry-After instead of obeying it literally', () => {
    // A provider asking for 5 minutes must not freeze a desktop app for 5
    // minutes; the clamp is reported so the budget can be extended instead.
    const delay = computeLlmRetryDelay({ policy, attempt: 1, retryAfterMs: 300_000 });
    expect(delay).toMatchObject({ delayMs: 1000, honoredRetryAfter: true, clamped: true });
  });
});

describe('cancellableLlmRetryDelay', () => {
  it('resolves true when the wait completes', async () => {
    await expect(cancellableLlmRetryDelay(1)).resolves.toBe(true);
  });

  it('resolves false on abort, so a Stop press interrupts the backoff', async () => {
    const controller = new AbortController();
    const pending = cancellableLlmRetryDelay(10_000, controller.signal);
    controller.abort();
    // The old code slept a flat setTimeout the user could not cancel.
    await expect(pending).resolves.toBe(false);
  });

  it('never starts a timer for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(cancellableLlmRetryDelay(10_000, controller.signal)).resolves.toBe(false);
  });
});

describe('createLlmRetryBudget', () => {
  it('caps the whole generation, not each call site', () => {
    // MAX_LLM_CALLS is 18; without one shared ceiling the per-site budgets
    // compose and a flapping provider bills far more than any single one.
    const budget = createLlmRetryBudget(2);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(false);
    expect(budget.remaining()).toBe(0);
  });
});

describe('createLlmRetryController', () => {
  const fast = { initialDelayMs: 1, maxDelayMs: 5, jitterRatio: 0 } as const;

  it('announces the wait before taking it', async () => {
    const notices: number[] = [];
    const controller = createLlmRetryController({
      policy: resolveLlmRetryPolicy({ ...fast, maxRetries: 1 }),
      onScheduled: (notice) => { notices.push(notice.attempt); },
    });
    await expect(controller.retryOrThrow({ status: 503 })).resolves.toBe(true);
    expect(notices).toEqual([1]);
  });

  it('returns false for a failure outside the retryable set', async () => {
    const controller = createLlmRetryController({ policy: resolveLlmRetryPolicy(fast) });
    await expect(controller.retryOrThrow({ status: 401 })).resolves.toBe(false);
    expect(controller.notices).toHaveLength(0);
  });

  it('throws the abort itself rather than reporting a retry', async () => {
    const controller = createLlmRetryController({ policy: resolveLlmRetryPolicy(fast) });
    const abort = new DOMException('aborted', 'AbortError');
    await expect(controller.retryOrThrow(abort)).rejects.toBe(abort);
  });

  it('stops once the site budget is spent', async () => {
    const controller = createLlmRetryController({ policy: resolveLlmRetryPolicy({ ...fast, maxRetries: 2 }) });
    await expect(controller.retryOrThrow({ status: 503 })).resolves.toBe(true);
    await expect(controller.retryOrThrow({ status: 503 })).resolves.toBe(true);
    await expect(controller.retryOrThrow({ status: 503 })).resolves.toBe(false);
  });

  it('stops once the generation budget is spent, even with site retries left', async () => {
    const budget = createLlmRetryBudget(1);
    const policy = resolveLlmRetryPolicy({ ...fast, maxRetries: 5 });
    const first = createLlmRetryController({ policy, budget });
    const second = createLlmRetryController({ policy, budget });
    await expect(first.retryOrThrow({ status: 503 })).resolves.toBe(true);
    // A different call site in the same generation must also run dry.
    await expect(second.retryOrThrow({ status: 503 })).resolves.toBe(false);
  });

  it('extends the allowance when the provider asked for longer than the cap', async () => {
    const controller = createLlmRetryController({
      policy: resolveLlmRetryPolicy({ ...fast, maxDelayMs: 10, maxRetries: 1, providerHintBonusRetries: 2 }),
      random: () => 0,
    });
    const overCap = () => new LlmFailureError({
      code: 'RATE_LIMIT', message: 'slow down', status: 429, retryAfterMs: 60_000,
    });
    // maxRetries 1 + bonus 2 = three attempts, then it gives up.
    await expect(controller.retryOrThrow(overCap())).resolves.toBe(true);
    await expect(controller.retryOrThrow(overCap())).resolves.toBe(true);
    await expect(controller.retryOrThrow(overCap())).resolves.toBe(true);
    await expect(controller.retryOrThrow(overCap())).resolves.toBe(false);
    expect(controller.notices[0]).toMatchObject({ clamped: true, honoredRetryAfter: true });
  });

  it('throws rather than retrying when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const retry = createLlmRetryController({
      policy: resolveLlmRetryPolicy(fast),
      signal: controller.signal,
    });
    await expect(retry.retryOrThrow({ status: 503 })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('withLlmRetry', () => {
  it('re-runs the work and returns the eventual success', async () => {
    let calls = 0;
    const text = await withLlmRetry(async () => {
      calls++;
      if (calls < 3) throw { status: 503, message: 'Service Unavailable' };
      return 'answer';
    }, { policy: resolveLlmRetryPolicy({ initialDelayMs: 1, maxDelayMs: 5, jitterRatio: 0, maxRetries: 3 }) });
    expect(text).toBe('answer');
    expect(calls).toBe(3);
  });

  it('rethrows the original error once retries are exhausted', async () => {
    const boom = { status: 503, message: 'Service Unavailable' };
    await expect(
      withLlmRetry(async () => { throw boom; }, {
        policy: resolveLlmRetryPolicy({ initialDelayMs: 1, maxDelayMs: 5, jitterRatio: 0, maxRetries: 1 }),
      }),
    ).rejects.toBe(boom);
  });

  it('does not re-run the work for a non-retryable failure', async () => {
    const run = vi.fn(async () => { throw { status: 401, message: 'Unauthorized' }; });
    await expect(
      withLlmRetry(run, { policy: resolveLlmRetryPolicy({ initialDelayMs: 1, maxDelayMs: 5, jitterRatio: 0 }) }),
    ).rejects.toMatchObject({ message: 'Unauthorized' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('resolveLlmRetryPolicy', () => {
  it('preserves the pre-existing BOZ pass budgets', () => {
    expect(DEFAULT_LLM_RETRY_POLICY.maxRetries).toBe(2);
  });

  it('rejects incoherent configuration', () => {
    expect(() => resolveLlmRetryPolicy({ initialDelayMs: 5000, maxDelayMs: 1000 })).toThrow(/less than or equal/);
    expect(() => resolveLlmRetryPolicy({ jitterRatio: 2 })).toThrow(/between 0 and 1/);
    expect(() => resolveLlmRetryPolicy({ maxRetries: -1 })).toThrow(/non-negative/);
    expect(() => resolveLlmRetryPolicy({ retryableCodes: [] })).toThrow(/must not be empty/);
    expect(() => resolveLlmRetryPolicy({ retryableCodes: ['NOPE' as never] })).toThrow(/unknown failure code/);
  });
});