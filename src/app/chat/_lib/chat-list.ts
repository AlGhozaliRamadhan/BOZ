// ─── chat/_lib/chat-list.ts ─────────────────────────────────────────────────
// Presentation helpers for the two chat lists: the sidebar's Recent Chats
// preview (capped at RECENT_CHATS_LIMIT rows) and the main-content All Chats
// page (every session, newest to oldest, searchable and paginated — 100+
// rows of compact entries are unreadable as one wall). Rows, previews,
// filtering, pagination, status labels, and ages are pure so both surfaces
// stay in sync and stay testable — no window, no storage access.

import { getSessionStatus } from './chat-sessions';
import type { ChatMessage, ChatSession } from './chat-types';
import type { ChatGenerationStatus } from '@/shared/chat-generation-status';

/** How many sessions the sidebar preview shows before pointing at All Chats. */
export const RECENT_CHATS_LIMIT = 10;

/** Rows the All Chats list shows per page. */
export const ALL_CHATS_PAGE_SIZE = 25;

/** Longest last-message snippet a list row shows beneath its title. */
const PREVIEW_LIMIT = 140;

/** Longest search blob built per session — bounds memory on huge threads. */
const SEARCH_LIMIT = 8_000;

export interface ChatListRow {
  id: string;
  title: string;
  status: ChatGenerationStatus;
  updatedAt: number;
  messageCount: number;
  preview: string;
  /**
   * Everything the list can match a query against: the title plus the whole
   * thread, collapsed to one lowercase-searchable blob (length-capped). The
   * row only displays `title` — this exists so a search finishes without
   * re-opening raw messages at filter time.
   */
  search: string;
}

/** The last message that carries any text — a thread may end on an empty stub. */
function lastTextMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message && typeof message.content === 'string' && message.content.trim()) {
      return message;
    }
  }
  return undefined;
}

/**
 * One flat line summarizing a conversation: its latest message, whitespace
 * collapsed and length-capped. Markdown stays raw — the row is plain text.
 */
export function sessionPreviewText(messages: ChatMessage[]): string {
  const source = lastTextMessage(messages);
  if (!source) return '';
  const text = source.content.replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT).trimEnd()}…` : text;
}

/** Every session as a display row, sorted newest first. */
export function buildChatList(sessions: ChatSession[]): ChatListRow[] {
  return sessions
    .map((session) => ({
      id: session.id,
      title: session.title,
      status: getSessionStatus(session),
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      preview: sessionPreviewText(session.messages),
      search: threadSearchText(session.title, session.messages),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The searchable text for one session: title plus every message, whitespace
 * collapsed and length-capped so searching stays bounded on long threads.
 */
function threadSearchText(title: string, messages: ChatMessage[]): string {
  const parts = [typeof title === 'string' ? title : ''];
  messages.forEach((message) => {
    if (message && typeof message.content === 'string') parts.push(message.content);
  });
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, SEARCH_LIMIT);
}

/** Rows whose searchable text contains every word of a whitespace-free query. */
export function filterChatRows(rows: ChatListRow[], query: string): ChatListRow[] {
  const predicate = buildRowFilter(query);
  if (!predicate) return rows;
  return rows.filter(predicate);
}

/** Builds a lowercase every-word matcher, or null when the query is empty. */
function buildRowFilter(rawQuery: string): ((row: ChatListRow) => boolean) | null {
  const query = rawQuery.toLowerCase().trim();
  if (!query) return null;
  const words = query.split(/\s+/);
  return (row) => {
    const searchable = (row.search || '').toLowerCase();
    return words.every((word) => searchable.includes(word));
  };
}

export interface PagedChatRows {
  items: ChatListRow[];
  total: number;
  /** 1-based, clamped into [1, pageCount] so shrinking result sets (a search
   * narrowing or a deleted last page item) never land on a missing page. */
  page: number;
  pageCount: number;
  /** 1-based inclusive bounds of this page within the full rows, 0 when empty. */
  start: number;
  end: number;
}

/** One page of rows with clamped bounds, for a plain numbered pager. */
export function paginateRows(
  rows: ChatListRow[],
  page: number,
  pageSize: number = ALL_CHATS_PAGE_SIZE,
): PagedChatRows {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, requested), pageCount);
  const firstIndex = (current - 1) * safePageSize;
  const items = rows.slice(firstIndex, firstIndex + safePageSize);
  return {
    items,
    total,
    page: current,
    pageCount,
    start: items.length > 0 ? firstIndex + 1 : 0,
    end: firstIndex + items.length,
  };
}

/** A pager cell: a page number, or a gap marker where pages were skipped. */
export type ChatPageCell = number | 'gap';

/**
 * Windowed pager numbers: first and last pages are always shown, the current
 * page keeps one neighbour on each side, and runs of hidden pages collapse
 * into one gap. Small ranges list every page — no gaps to explain.
 */
export function chatPageCells(pageCount: number, current: number): ChatPageCell[] {
  if (pageCount <= 7) {
    return Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1);
  }
  const wanted = new Set<number>([1, pageCount, current - 1, current, current + 1]);
  const cells: ChatPageCell[] = [];
  let previous: number | null = null;
  for (let page = 1; page <= pageCount; page++) {
    if (!wanted.has(page)) continue;
    if (previous !== null && page - previous > 1) cells.push('gap');
    cells.push(page);
    previous = page;
  }
  return cells;
}

/** The one-line status a list row shows beside a chat title. */
export function chatStatusLabel(status: ChatGenerationStatus): string {
  if (status === 'streaming') return 'Generating…';
  if (status === 'error' || status === 'interrupted') return 'Needs attention';
  if (status === 'cancelled') return 'Stopped';
  return 'Finished';
}

/**
 * "2m ago"-style age for a session, stable in tests through the `now`
 * parameter. Beyond a week the text stops pretending to be relative and
 * prints a fixed `en-US` date instead.
 */
export function relativeChatAge(timestamp: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;

  const at = new Date(timestamp);
  const day = String(at.getUTCDate()).padStart(2, '0');
  const month = at.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = at.getUTCFullYear() === new Date(now).getUTCFullYear()
    ? null
    : at.getUTCFullYear();
  return year === null ? `${day} ${month}` : `${day} ${month} ${year}`;
}
