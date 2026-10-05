export interface AssistantMessageMetrics {
  outputCharacters: number;
  outputWords: number;
  outputTokensEstimate: number;
  totalDurationMs: number;
  timeToFirstTokenMs?: number;
  streamingDurationMs?: number;
  outputTokensPerSecond?: number;
  toolCount: number;
}

export function estimateOutputTokens(content: string): number {
  const trimmed = content.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
}

export function countWords(content: string): number {
  return content.trim().match(/\S+/g)?.length ?? 0;
}

export function buildAssistantMessageMetrics(options: {
  content: string;
  startedAt: number;
  firstTokenAt?: number;
  completedAt: number;
  toolCount: number;
}): AssistantMessageMetrics {
  const outputTokensEstimate = estimateOutputTokens(options.content);
  const totalDurationMs = Math.max(0, options.completedAt - options.startedAt);
  const timeToFirstTokenMs = options.firstTokenAt === undefined
    ? undefined
    : Math.max(0, options.firstTokenAt - options.startedAt);
  const streamingDurationMs = options.firstTokenAt === undefined
    ? undefined
    : Math.max(0, options.completedAt - options.firstTokenAt);
  const outputTokensPerSecond = streamingDurationMs && streamingDurationMs > 0
    ? outputTokensEstimate / (streamingDurationMs / 1000)
    : undefined;

  return {
    outputCharacters: options.content.length,
    outputWords: countWords(options.content),
    outputTokensEstimate,
    totalDurationMs,
    timeToFirstTokenMs,
    streamingDurationMs,
    outputTokensPerSecond,
    toolCount: options.toolCount,
  };
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds >= 10_000 ? 0 : 1)}s`;
}

export function formatTokensPerSecond(tokensPerSecond?: number): string | null {
  return tokensPerSecond === undefined || !Number.isFinite(tokensPerSecond)
    ? null
    : `${tokensPerSecond.toFixed(1)} tok/s`;
}
