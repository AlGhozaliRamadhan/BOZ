import { describe, expect, it } from 'vitest';
import {
  buildPausedChatResponse,
  chatStreamFailureFromLlmFailure,
  classifyChatStreamFailure,
  describeChatStreamFailure,
  type ChatStreamFailureCode,
} from '../src/shared/chat-stream-failure';
import { normalizeLlmFailure } from '../src/shared/llm-retry';

describe('chat stream failures', () => {
  it('explains a rate-limited stream and retains a partial answer', () => {
    const response = buildPausedChatResponse({
      partialContent: 'The price trend is improving.',
      completedResearch: true,
      failure: { status: 429, message: 'Too many chat requests are already running' },
    });

    expect(classifyChatStreamFailure({ status: 429 })).toBe('busy');
    expect(response).toContain('The price trend is improving.');
    expect(response).toContain('Wait 15–30 seconds, then retry.');
    expect(response).toContain('completed research timeline is retained below');
  });

  it('gives a settings action for authentication failures without echoing the raw provider error', () => {
    const rawError = '401 Incorrect API key: sk-secret-value';
    const response = buildPausedChatResponse({
      failure: { status: 401, message: rawError },
    });

    expect(describeChatStreamFailure({ status: 401, message: rawError })).toContain('Check Settings');
    expect(response).not.toContain(rawError);
    expect(response).not.toContain('sk-secret-value');
  });

  it('identifies interrupted connections and preserves a clear retry path', () => {
    const failure = { message: 'TypeError: Failed to fetch' };

    expect(classifyChatStreamFailure(failure)).toBe('connection_interrupted');
    expect(describeChatStreamFailure(failure)).toContain('Wait a moment, then retry.');
  });

  it('preserves a safe failure code sent by the stream endpoint', () => {
    expect(describeChatStreamFailure({
      code: 'service_unavailable',
      message: 'The model or a data source is temporarily unavailable.',
    })).toContain('temporarily unavailable');
  });

  it('trusts the retry taxonomy instead of re-guessing from the message', () => {
    // The engine and adapter have already classified this; a second regex
    // pass over the text could only disagree with them.
    expect(classifyChatStreamFailure({ code: 'RATE_LIMIT', status: 429 })).toBe('busy');
    expect(classifyChatStreamFailure({ code: 'AUTH', status: 401 })).toBe('provider_authentication');
    expect(classifyChatStreamFailure({ code: 'TIMEOUT' })).toBe('timeout');
    expect(classifyChatStreamFailure({ code: 'TRANSPORT' })).toBe('connection_interrupted');
    expect(classifyChatStreamFailure({ code: 'CONTEXT_WINDOW_EXCEEDED' })).toBe('execution_limit');
  });

  it('maps every classified LLM failure code to actionable guidance', () => {
    // Total mapping: an unmapped code would fall through to 'unknown' and
    // lose the actionable 'Check Settings' / 'narrower question' guidance.
    const classified = [
      'RATE_LIMIT', 'QUOTA', 'SERVER', 'TIMEOUT', 'TRANSPORT',
      'EMPTY_RESPONSE', 'AUTH', 'INVALID_REQUEST',
      'CONTEXT_WINDOW_EXCEEDED', 'EXECUTION_LIMIT',
    ] as const;
    for (const code of classified) {
      const failure = chatStreamFailureFromLlmFailure({ code, message: 'raw provider text' });
      expect(failure.code, code).not.toBe('unknown');
      expect(describeChatStreamFailure(failure), code).not.toMatch(/did not finish a final response/);
    }
    // UNKNOWN is the one code that legitimately lands on the generic text.
    expect(chatStreamFailureFromLlmFailure({ code: 'UNKNOWN', message: '' }).code).toBe('unknown');
  });

  it('never carries a provider message into the reader-facing failure', () => {
    // The same trust boundary as assistant text: a provider error can hold an
    // API key or an internal URL.
    const failure = chatStreamFailureFromLlmFailure(
      normalizeLlmFailure({ status: 401, message: '401 Incorrect API key: sk-secret-value' }),
    );
    expect(JSON.stringify(failure)).not.toContain('sk-secret-value');
    expect(describeChatStreamFailure(failure)).toContain('Check Settings');
  });

  it('keeps the non-adapter codes the retry layer never sees', () => {
    // The workload gate and the setup check fail before any LLM adapter runs.
    expect(classifyChatStreamFailure({ code: 'busy', message: 'Too many chat requests' })).toBe('busy');
    expect(classifyChatStreamFailure({ code: 'provider_setup' })).toBe('provider_setup');
  });
});

describe('classifyChatStreamFailure agreement with the retry taxonomy', () => {
  it('never reports a retryable provider failure as a non-retryable one', () => {
    const retryable: Record<string, ChatStreamFailureCode> = {
      RATE_LIMIT: 'busy',
      SERVER: 'service_unavailable',
      TIMEOUT: 'timeout',
      TRANSPORT: 'connection_interrupted',
    };
    for (const [code, expected] of Object.entries(retryable)) {
      expect(classifyChatStreamFailure({ code })).toBe(expected);
    }
  });
});

describe('truncated streams', () => {
  it('classifies them as interrupted connections', () => {
    expect(
      classifyChatStreamFailure({ message: 'Connection closed before the final response completed' }),
    ).toBe('connection_interrupted');
  });
});
