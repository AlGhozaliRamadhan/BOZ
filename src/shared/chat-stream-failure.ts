export type ChatStreamFailureCode =
  | 'busy'
  | 'provider_authentication'
  | 'timeout'
  | 'service_unavailable'
  | 'connection_interrupted'
  | 'execution_limit'
  | 'unknown';

export interface ChatStreamFailure {
  status?: number;
  code?: string;
  message?: string;
}

export interface PausedChatResponseOptions {
  partialContent?: string;
  completedResearch?: boolean;
  failure: ChatStreamFailure;
}

const KNOWN_FAILURE_CODES = new Set<ChatStreamFailureCode>([
  'busy',
  'provider_authentication',
  'timeout',
  'service_unavailable',
  'connection_interrupted',
  'execution_limit',
  'unknown',
]);

function normalizedText(failure: ChatStreamFailure): string {
  return `${failure.code ?? ''} ${failure.message ?? ''}`.toLowerCase();
}

export function classifyChatStreamFailure(failure: ChatStreamFailure): ChatStreamFailureCode {
  if (failure.code && KNOWN_FAILURE_CODES.has(failure.code as ChatStreamFailureCode)) {
    return failure.code as ChatStreamFailureCode;
  }

  const text = normalizedText(failure);

  if (
    failure.status === 429 ||
    /\b(rate.?limit|too many requests|concurrency limit|workload.*busy|provider_busy|busy)\b/.test(text)
  ) {
    return 'busy';
  }
  if (failure.status === 401 || failure.status === 403 || /\b(unauthori[sz]ed|forbidden|invalid api key|authentication)\b/.test(text)) {
    return 'provider_authentication';
  }
  if (failure.status === 408 || /\b(timeout|timed out|deadline exceeded|etimedout|econnaborted)\b/.test(text)) {
    return 'timeout';
  }
  if (failure.status === 502 || failure.status === 503 || failure.status === 504 || /\b(service unavailable|bad gateway|gateway timeout|upstream)\b/.test(text)) {
    return 'service_unavailable';
  }
  if (/\b(max(imum)? (token|call|tool)|execution limit|context length|budget)\b/.test(text)) {
    return 'execution_limit';
  }
  if (/\b(failed to fetch|network.?error|connection (reset|refused|closed|interrupted)|econnreset|enotfound|eai_again)\b/.test(text)) {
    return 'connection_interrupted';
  }
  return 'unknown';
}

export function describeChatStreamFailure(failure: ChatStreamFailure): string {
  switch (classifyChatStreamFailure(failure)) {
    case 'busy':
      return 'BOZ or its model provider is busy or rate-limited. Wait 15–30 seconds, then retry.';
    case 'provider_authentication':
      return 'The selected model provider rejected the request because its connection or credentials need attention. Check Settings, then retry.';
    case 'timeout':
      return 'The model or a data source timed out before final synthesis. Wait a moment, then retry.';
    case 'service_unavailable':
      return 'The model or a data source is temporarily unavailable. Wait a moment, then retry.';
    case 'connection_interrupted':
      return 'The connection to the model or data service was interrupted. Wait a moment, then retry.';
    case 'execution_limit':
      return 'The analysis reached an execution limit before final synthesis. Retry with a narrower question.';
    default:
      return 'The model could not finish the final response. Wait a moment, then retry.';
  }
}

/**
 * Turns a failed stream into a useful assistant message without exposing raw
 * provider errors, which can contain credentials, URLs, or implementation details.
 */
export function buildPausedChatResponse({
  partialContent,
  completedResearch = false,
  failure,
}: PausedChatResponseOptions): string {
  const status = describeChatStreamFailure(failure);
  const preservedResearch = completedResearch
    ? 'The completed research timeline is retained below.'
    : 'No completed analysis steps were removed.';
  const partial = partialContent?.trim();

  if (partial) {
    return `${partial}\n\n---\n\n**Response paused.** ${status}\n\n${preservedResearch}`;
  }

  return `**Response paused.** BOZ did not finish a final answer.\n\n**What happened:** ${status}\n\n${preservedResearch}`;
}
