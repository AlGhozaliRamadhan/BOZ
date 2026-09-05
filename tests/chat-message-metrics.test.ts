import { describe, expect, it } from 'vitest';
import {
  buildAssistantMessageMetrics,
  estimateOutputTokens,
  formatDuration,
  formatTokensPerSecond,
} from '../src/app/chat/chat-message-metrics';

describe('chat message metrics', () => {
  it('records estimated output tokens and client-side streaming timing', () => {
    const metrics = buildAssistantMessageMetrics({
      content: 'Hello global market!',
      startedAt: 100,
      firstTokenAt: 1_100,
      completedAt: 2_100,
      toolCount: 2,
    });

    expect(metrics).toMatchObject({
      outputCharacters: 20,
      outputWords: 3,
      outputTokensEstimate: 5,
      totalDurationMs: 2_000,
      timeToFirstTokenMs: 1_000,
      streamingDurationMs: 1_000,
      outputTokensPerSecond: 5,
      toolCount: 2,
    });
  });

  it('formats the compact values shown in the chat footer', () => {
    expect(estimateOutputTokens('')).toBe(0);
    expect(formatDuration(650)).toBe('650ms');
    expect(formatDuration(1_250)).toBe('1.3s');
    expect(formatTokensPerSecond(4.25)).toBe('4.3 tok/s');
  });
});
