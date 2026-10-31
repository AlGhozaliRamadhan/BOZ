import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTransientToolError,
  runToolWithRetries,
  TOOL_RETRY_DELAYS_MS,
  type ToolRetryNotice,
} from '../src/shared/tool-retry.js';

// A flaky upstream used to sink a tool call on first failure: the timeline
// showed one bad observation and the answer lost its evidence. These pin the
// auto-retry that now stands between the network and the answer — what is
// retried, what never is, and how the wait is announced.

const instant = () => Promise.resolve();

describe('isTransientToolError', () => {
  it('retries timeouts, rate limits, and server errors', () => {
    expect(isTransientToolError({ response: { status: 429 }, message: 'Too Many Requests' })).toBe('rate_limited');
    expect(isTransientToolError({ status: 503, message: 'Service Unavailable' })).toBe('server_error');
    expect(isTransientToolError({ response: { status: 500 }, message: 'Internal Server Error' })).toBe('server_error');
    expect(isTransientToolError({ statusCode: 408, message: 'Request Timeout' })).toBe('timeout');
    expect(isTransientToolError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' })).toBe('timeout');
    expect(isTransientToolError({ code: 'ECONNABORTED', message: 'timeout of 9000ms exceeded' })).toBe('timeout');
    expect(isTransientToolError({ code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe('network');
  });

  it('reads messages when no status is attached', () => {
    expect(isTransientToolError(new Error('socket hang up'))).toBe('network');
    expect(isTransientToolError(new Error('fetch failed'))).toBe('network');
    expect(isTransientToolError(new Error('gateway timeout while reading body'))).toBe('server_error');
  });

  it('never retries aborts, auth, or client errors', () => {
    expect(isTransientToolError(new DOMException('aborted', 'AbortError'))).toBeNull();
    expect(isTransientToolError({ status: 401, message: 'Unauthorized' })).toBeNull();
    expect(isTransientToolError({ status: 403, message: 'Forbidden' })).toBeNull();
    expect(isTransientToolError({ status: 404, message: 'Not Found' })).toBeNull();
    expect(isTransientToolError(new Error('invalid api key'))).toBeNull();
    expect(isTransientToolError(null)).toBeNull();
    expect(isTransientToolError(undefined)).toBeNull();
  });
});

describe('runToolWithRetries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the observation untouched when the call succeeds', async () => {
    const run = vi.fn(async () => '=== VOO DASHBOARD ===');
    const notices: ToolRetryNotice[] = [];
    const result = await runToolWithRetries({
      tool: 'fetch_ticker_dashboard',
      args: { symbol: 'VOO' },
      run,
      onRetry: (n) => notices.push(n),
      sleep: instant,
    });
    expect(result).toBe('=== VOO DASHBOARD ===');
    expect(run).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it('retries a transient error and announces the retry before each wait', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      if (calls <= 2) throw Object.assign(new Error('boom'), { response: { status: 503 } });
      return 'recovered data';
    };
    const waits: number[] = [];
    const notices: ToolRetryNotice[] = [];
    const result = await runToolWithRetries({
      tool: 'fetch_price',
      args: { symbol_or_name: 'NVDA' },
      run,
      onRetry: (n) => notices.push(n),
      sleep: async (ms) => { waits.push(ms); },
    });
    expect(result).toBe('recovered data');
    expect(calls).toBe(3);
    expect(notices.map((n) => n.attempt)).toEqual([1, 2]);
    expect(notices.map((n) => n.code)).toEqual(['server_error', 'server_error']);
    expect(notices.map((n) => n.allowance)).toEqual([3, 3]);
    expect(notices.map((n) => n.tool)).toEqual(['fetch_price', 'fetch_price']);
    expect(waits).toEqual(TOOL_RETRY_DELAYS_MS.slice(0, 2));
  });

  it('retries a literally empty observation like a transport failure', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return calls === 1 ? '' : 'actual data';
    };
    const notices: ToolRetryNotice[] = [];
    const result = await runToolWithRetries({
      tool: 'fetch_sentiment',
      run,
      onRetry: (n) => notices.push(n),
      sleep: instant,
    });
    expect(result).toBe('actual data');
    expect(calls).toBe(2);
    expect(notices).toEqual([
      { tool: 'fetch_sentiment', args: {}, attempt: 1, allowance: 3, code: 'empty' },
    ]);
  });

  it('never retries a permanent verdict ("no results" is an answer, not an outage)', async () => {
    const run = vi.fn(async () => 'No news found for "XYZ".');
    const notices: ToolRetryNotice[] = [];
    const result = await runToolWithRetries({
      tool: 'fetch_news',
      run,
      onRetry: (n) => notices.push(n),
      sleep: instant,
    });
    expect(result).toBe('No news found for "XYZ".');
    expect(run).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it('never retries auth or client errors', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('invalid credentials'), { status: 401 });
    });
    const notices: ToolRetryNotice[] = [];
    await expect(runToolWithRetries({ tool: 'fetch_price', run, onRetry: (n) => notices.push(n), sleep: instant }))
      .rejects.toThrow('invalid credentials');
    expect(run).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it('gives up after the configured retries and keeps the last error', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      throw Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
    };
    const notices: ToolRetryNotice[] = [];
    await expect(runToolWithRetries({
      tool: 'web_search',
      run,
      maxRetries: 2,
      delaysMs: [0, 0],
      onRetry: (n) => notices.push(n),
      sleep: instant,
    })).rejects.toThrow('Service Unavailable');
    expect(calls).toBe(3); // initial attempt + 2 retries
    expect(notices.map((n) => n.attempt)).toEqual([1, 2]);
    expect(notices.map((n) => n.allowance)).toEqual([2, 2]);
  });
});
