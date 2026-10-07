// ─── shared/chat-generation-status.ts ─────────────────────────────────────────
// Lifecycle of one assistant generation, shared by the client stream manager,
// the chat session store, and the recent-chat list.
// Pure module: no `use client`, no DOM — safe to import anywhere.

export type ChatGenerationStatus =
  | 'streaming'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'interrupted';

const TERMINAL_STATUSES: ReadonlySet<ChatGenerationStatus> = new Set([
  'done',
  'error',
  'cancelled',
  'interrupted',
]);

export function isTerminalChatStatus(status: ChatGenerationStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isChatGenerationStatus(value: unknown): value is ChatGenerationStatus {
  return (
    value === 'streaming' ||
    value === 'done' ||
    value === 'error' ||
    value === 'cancelled' ||
    value === 'interrupted'
  );
}

/**
 * Guards status writes. `undefined` is a legacy message stored before status
 * tracking existed — it may transition anywhere. Terminal states never leave
 * terminal; only `streaming` may move.
 */
export function canTransitionChatStatus(
  from: ChatGenerationStatus | undefined,
  to: ChatGenerationStatus,
): boolean {
  if (from === undefined) return true;
  if (from === to) return true;
  if (isTerminalChatStatus(from)) return false;
  return true;
}

interface StatusMessageLike {
  role: string;
  status?: ChatGenerationStatus;
}

/**
 * Rolls a message list up to one session status. Scanning from the end, the
 * first message decides: an assistant message reports its own status (legacy
 * messages stored before status tracking were only ever persisted on
 * completion, so they count as `done`); a trailing user message with no
 * assistant reply means a generation is (or was) in flight. An empty thread
 * is `done` — nothing is generating.
 */
export function rollupChatStatus(messages: StatusMessageLike[]): ChatGenerationStatus {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === 'assistant') {
      return message.status ?? 'done';
    }
    if (message?.role === 'user') {
      return 'streaming';
    }
  }
  return 'done';
}
