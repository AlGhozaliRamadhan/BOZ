'use client';

// ─── chat/_components/AllChats.tsx ──────────────────────────────────────────
// Full history page for the main content area: every stored chat, newest to
// oldest, each row carrying its own facts — generation status, the last
// message it exchanged, how long ago it ran, and how many turns it has.
// The sidebar's Recent Chats preview caps at a short list; this page is where
// the rest lives ("Show all chats"). With real histories that means hundreds
// of rows, so the list is paginated (ALL_CHATS_PAGE_SIZE per page) and
// searchable — a query filters across titles and whole threads, and matches
// keep their page place. Reads through the session store so rows refresh
// live — a chat generating in another view shows its spinner here — and
// deletes go through the store so the sidebar stays in sync.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ChatGenerationStatus } from '@/shared/chat-generation-status';
import {
  ALL_CHATS_PAGE_SIZE,
  buildChatList,
  chatPageCells,
  chatStatusLabel,
  filterChatRows,
  paginateRows,
  relativeChatAge,
  type ChatListRow,
} from '../_lib/chat-list';
import { CHAT_UPDATED_EVENT, NEW_CHAT_EVENT } from '../_lib/chat-storage';
import { deleteSessionById, loadListedSessions } from '../_lib/chat-sessions';
import { isStreamActive, stopStream } from '../_lib/chat-stream-manager';
import css from './AllChats.module.css';

const statusClass: Record<ChatGenerationStatus, string> = {
  streaming: css.statusStreaming,
  done: css.statusDone,
  error: css.statusAttention,
  interrupted: css.statusAttention,
  cancelled: css.statusCancelled,
};

const statusIcon: Record<Exclude<ChatGenerationStatus, 'streaming'>, string> = {
  done: 'fa-regular fa-message',
  cancelled: 'fa-regular fa-circle-stop',
  error: 'fa-solid fa-triangle-exclamation',
  interrupted: 'fa-solid fa-triangle-exclamation',
};

export default function AllChats() {
  const [rows, setRows] = useState<ChatListRow[]>([]);
  const [query, setQuery] = useState('');
  const [requestedPage, setRequestedPage] = useState(1);

  // Same load discipline as the sidebar: reconcile once on mount (heals
  // orphaned generations after a reload), then trail the store event without
  // reconciling so a live stream never looks orphaned mid-answer.
  useEffect(() => {
    const loadSessions = (reconcile: boolean) => {
      try {
        setRows(buildChatList(loadListedSessions(window.localStorage, isStreamActive, reconcile)));
      } catch {
        setRows([]);
      }
    };
    loadSessions(true);
    const handleUpdated = () => loadSessions(false);
    window.addEventListener(CHAT_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(CHAT_UPDATED_EVENT, handleUpdated);
  }, []);

  const searching = query.trim().length > 0;
  const filtered = useMemo(() => filterChatRows(rows, query), [rows, query]);
  const paged = useMemo(
    () => paginateRows(filtered, requestedPage, ALL_CHATS_PAGE_SIZE),
    [filtered, requestedPage],
  );
  const cells = useMemo(
    () => chatPageCells(paged.pageCount, paged.page),
    [paged.pageCount, paged.page],
  );

  const onSearch = (next: string) => {
    setQuery(next);
    // A new query starts a new reading place; a stale page number would
    // otherwise clamp to a random tail of the narrowed list.
    setRequestedPage(1);
  };

  const deleteRow = (id: string) => {
    // Stop a live generation first so it cannot re-persist progress into a
    // session the user just deleted. The store removes the session and
    // announces the change, and the announcement refreshes this page and the
    // sidebar through their event listeners.
    stopStream(id);
    deleteSessionById(window.localStorage, id);
    // Belt and braces for the rare no-op delete (already removed elsewhere):
    // drop the row locally even when no announcement follows.
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const openNewChat = () => {
    window.dispatchEvent(new Event(NEW_CHAT_EVENT));
  };

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>All chats</h1>
          <p className={css.subtitle}>
            {searching
              ? paged.total === 1
                ? '1 result'
                : `${paged.total} results`
              : rows.length > 0
                ? `${rows.length} conversation${rows.length === 1 ? '' : 's'}, newest to oldest`
                : 'Your conversations will appear here'}
          </p>
        </div>
        <Link href="/chat" onClick={openNewChat} className={css.newChatBtn}>
          <i className="fa-solid fa-plus" aria-hidden="true"></i>
          <span>New chat</span>
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="empty-state">
          <i className="fa-regular fa-comment-dots empty-state-icon" aria-hidden="true"></i>
          <div className="empty-state-title">No chats yet</div>
          <p className="empty-state-text">
            Start a conversation and it will be saved here, ready to pick up any time.
          </p>
          <Link href="/chat" onClick={openNewChat} className={css.emptyAction}>
            Start your first chat
          </Link>
        </div>
      ) : (
        <>
          <div className={css.toolbar}>
            <label className={css.searchBox}>
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input
                type="search"
                className={css.searchInput}
                value={query}
                onChange={(event) => onSearch(event.target.value)}
                placeholder="Search title or messages…"
                aria-label="Search chats by title or message text"
              />
            </label>
            {searching && (
              <button
                type="button"
                className={css.clearSearch}
                onClick={() => onSearch('')}
                title="Clear search"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true"></i>
                <span>Clear</span>
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <i className="fa-solid fa-magnifying-glass empty-state-icon" aria-hidden="true"></i>
              <div className="empty-state-title">No chats match {`"${query.trim()}"`}</div>
              <p className="empty-state-text">
                Titles and message text all match. Try a shorter or different word.
              </p>
              <button type="button" className={css.emptyAction} onClick={() => onSearch('')}>
                Clear search
              </button>
            </div>
          ) : (
            <>
              <div className={css.list} role="list">
                {paged.items.map((row) => {
                  const age = relativeChatAge(row.updatedAt);
                  const statusLabel = chatStatusLabel(row.status);
                  return (
                    <div
                      key={row.id}
                      role="listitem"
                      className={`${css.row} ${statusClass[row.status]}`}
                    >
                      <Link
                        href={`/chat/${row.id}`}
                        className={css.rowLink}
                        title={`${row.title} — ${statusLabel}`}
                      >
                        <span className={css.statusIcon}>
                          {row.status === 'streaming' ? (
                            <span className="spinner spinner-xs" role="status" aria-label="Generating" />
                          ) : (
                            <i className={statusIcon[row.status]} aria-label={statusLabel} />
                          )}
                        </span>
                        <span className={css.rowMain}>
                          <span className={css.rowTop}>
                            <span className={css.rowTitle}>{row.title}</span>
                            {age && <span className={css.rowAge}>{age}</span>}
                          </span>
                          <span className={css.rowPreview}>{row.preview || 'No messages yet'}</span>
                          <span className={css.rowMeta}>
                            <span>{statusLabel}</span>
                            <span className={css.metaDot} aria-hidden="true">·</span>
                            <span>{row.messageCount} message{row.messageCount === 1 ? '' : 's'}</span>
                          </span>
                        </span>
                      </Link>
                      <button
                        type="button"
                        className={css.deleteBtn}
                        onClick={() => deleteRow(row.id)}
                        title="Delete chat"
                        aria-label={`Delete chat ${row.title}`}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  );
                })}
              </div>

              {paged.pageCount > 1 && (
                <footer className={css.pager}>
                  <span className={css.pagerInfo}>
                    Showing {paged.start}–{paged.end} of {paged.total}
                  </span>
                  <nav className={css.pagerPages} aria-label="Chat history pages">
                    <button
                      type="button"
                      className={`${css.pagerBtn} ${css.pagerNav}`}
                      disabled={paged.page === 1}
                      onClick={() => setRequestedPage(paged.page - 1)}
                      title="Previous page"
                      aria-label="Previous page"
                    >
                      <i className="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    {cells.map((cell, index) =>
                      cell === 'gap' ? (
                        <span key={`gap-${index}`} className={css.pagerGap} aria-hidden="true">
                          …
                        </span>
                      ) : (
                        <button
                          key={cell}
                          type="button"
                          className={`${css.pagerBtn}${cell === paged.page ? ` ${css.pagerCurrent}` : ''}`}
                          aria-current={cell === paged.page ? 'page' : undefined}
                          onClick={() => setRequestedPage(cell)}
                        >
                          {cell}
                        </button>
                      ),
                    )}
                    <button
                      type="button"
                      className={`${css.pagerBtn} ${css.pagerNav}`}
                      disabled={paged.page === paged.pageCount}
                      onClick={() => setRequestedPage(paged.page + 1)}
                      title="Next page"
                      aria-label="Next page"
                    >
                      <i className="fa-solid fa-chevron-right" aria-hidden="true"></i>
                    </button>
                  </nav>
                </footer>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
