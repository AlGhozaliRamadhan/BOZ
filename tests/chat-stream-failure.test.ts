import { describe, expect, it } from 'vitest';
import {
  buildPausedChatResponse,
  classifyChatStreamFailure,
  describeChatStreamFailure,
} from '../src/shared/chat-stream-failure';

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
});
