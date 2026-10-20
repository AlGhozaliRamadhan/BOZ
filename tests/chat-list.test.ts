import { describe, expect, it } from 'vitest';
import {
  ALL_CHATS_PAGE_SIZE,
  RECENT_CHATS_LIMIT,
  buildChatList,
  chatPageCells,
  chatStatusLabel,
  filterChatRows,
  paginateRows,
  relativeChatAge,
  sessionPreviewText,
} from '../src/app/chat/_lib/chat-list';
import type { ChatSession } from '../src/app/chat/_lib/chat-types';

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'chat-1',
    title: 'Test chat',
    messages: [{ role: 'user', content: 'hello' }],
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('RECENT_CHATS_LIMIT', () => {
  it('caps the sidebar preview at ten rows', () => {
    expect(RECENT_CHATS_LIMIT).toBe(10);
  });
});

describe('sessionPreviewText', () => {
  it('uses the latest message that carries any text', () => {
    const preview = sessionPreviewText([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'second question' },
    ]);
    expect(preview).toBe('second question');
  });

  it('collapses markdown whitespace into one flat line', () => {
    const preview = sessionPreviewText([{ role: 'user', content: 'hello\n\tworld\n\nagain' }]);
    expect(preview).toBe('hello world again');
    expect(preview).not.toMatch(/\s{2,}/);
  });

  it('caps long snippets with an ellipsis', () => {
    const long = 'a'.repeat(500);
    const preview = sessionPreviewText([{ role: 'assistant', content: long }]);
    expect(preview.length).toBeLessThan(long.length);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('is empty for a session with no readable messages', () => {
    expect(sessionPreviewText([])).toBe('');
    expect(sessionPreviewText([{ role: 'assistant', content: '   ' }])).toBe('');
  });
});

describe('buildChatList', () => {
  it('maps every session to a row sorted newest first', () => {
    const rows = buildChatList([
      session({ id: 'old', updatedAt: 100, messages: [{ role: 'assistant', content: 'done', status: 'done' }] }),
      session({ id: 'new', updatedAt: 300, messages: [{ role: 'user', content: 'pending' }] }),
      session({ id: 'mid', updatedAt: 200, messages: [{ role: 'assistant', content: 'partial', status: 'cancelled' }] }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['new', 'mid', 'old']);
    expect(rows[0]).toMatchObject({
      id: 'new',
      title: 'Test chat',
      status: 'streaming',
      messageCount: 1,
      preview: 'pending',
    });
  });

  it('rolls the session status up: hidden live streams stay generating', () => {
    const [row] = buildChatList([
      session({
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: '', status: 'streaming' },
        ],
      }),
    ]);
    expect(row.status).toBe('streaming');
  });
});

describe('chatStatusLabel', () => {
  it('labels every status the lists can show', () => {
    expect(chatStatusLabel('streaming')).toBe('Generating…');
    expect(chatStatusLabel('error')).toBe('Needs attention');
    expect(chatStatusLabel('interrupted')).toBe('Needs attention');
    expect(chatStatusLabel('cancelled')).toBe('Stopped');
    expect(chatStatusLabel('done')).toBe('Finished');
  });
});

describe('relativeChatAge', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);

  it('treats fresh activity as just now and counts up from there', () => {
    expect(relativeChatAge(now - 30_000, now)).toBe('Just now');
    expect(relativeChatAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeChatAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeChatAge(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('prints a fixed date once the age passes a week', () => {
    expect(relativeChatAge(now - 8 * 86_400_000, now)).toBe('02 Jan');
    expect(relativeChatAge(Date.UTC(2024, 5, 3), now)).toBe('03 Jun 2024');
  });

  it('never goes negative for clock skew', () => {
    expect(relativeChatAge(now + 30_000, now)).toBe('Just now');
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(relativeChatAge(0, now)).toBeNull();
    expect(relativeChatAge(Number.NaN, now)).toBeNull();
  });
});

function pagedRows(count: number): ReturnType<typeof buildChatList> {
  return buildChatList(
    Array.from({ length: count }, (_, index) =>
      session({ id: `chat-${index + 1}`, updatedAt: 10_000 - index }),
    ),
  );
}

describe('filterChatRows', () => {
  const rows = buildChatList([
    session({
      id: 'osprey',
      title: 'CAR spread',
      updatedAt: 300,
      messages: [
        { role: 'user', content: 'osprey said something about the lead smelter' },
        { role: 'assistant', content: 'sure' },
        { role: 'user', content: 'how does that work' },
      ],
    }),
    session({
      id: 'lamppost',
      title: 'Tiny dip question',
      updatedAt: 200,
      messages: [{ role: 'user', content: 'why is KLNG dipping today' }],
    }),
    session({ id: 'empty', title: 'Empty thread', updatedAt: 100, messages: [] }),
  ]);

  it('matches the title and thread text case-insensitively', () => {
    expect(filterChatRows(rows, 'dip').map((row) => row.id)).toEqual(['lamppost']);
    expect(filterChatRows(rows, 'OSPREY').map((row) => row.id)).toEqual(['osprey']);
  });

  it('matches message content beyond the one-row preview', () => {
    // "osprey" sits two messages back — the preview only shows the last one.
    expect(filterChatRows(rows, 'smelter').map((row) => row.id)).toEqual(['osprey']);
  });

  it('requires every word to match, not just one', () => {
    expect(filterChatRows(rows, 'tiny dip').map((row) => row.id)).toEqual(['lamppost']);
    expect(filterChatRows(rows, 'tiny smear')).toEqual([]);
  });

  it('returns nothing for a word no thread contains, everything for a blank query', () => {
    expect(filterChatRows(rows, 'quintessential')).toEqual([]);
    expect(filterChatRows(rows, '')).toEqual(rows);
  });

  it('ignores whitespace around and inside the query', () => {
    expect(filterChatRows(rows, '  dip   question ')).toEqual(
      filterChatRows(rows, 'dip question'),
    );
  });
});

describe('paginateRows', () => {
  it('slices default-sized pages with inclusive bounds', () => {
    expect(ALL_CHATS_PAGE_SIZE).toBe(25);
    const paged = paginateRows(pagedRows(30), 1);
    expect(paged.pageCount).toBe(2);
    expect(paged.items).toHaveLength(25);
    expect([paged.start, paged.end]).toEqual([1, 25]);
    expect(paged.total).toBe(30);

    const tail = paginateRows(pagedRows(30), 2);
    expect(tail.items).toHaveLength(5);
    expect([tail.start, tail.end]).toEqual([26, 30]);
  });

  it('clamps requests past the last page back onto it', () => {
    const paged = paginateRows(pagedRows(30), 9);
    expect(paged.page).toBe(2);
    expect(paged.items).toHaveLength(5);
  });

  it('never lands on page zero or splits garbage input', () => {
    expect(paginateRows(pagedRows(5), 0).page).toBe(1);
    expect(paginateRows(pagedRows(5), Number.NaN).page).toBe(1);
    expect(paginateRows(pagedRows(5), 1.7).page).toBe(1);
  });

  it('degrades cleanly to one empty page', () => {
    const paged = paginateRows([], 1);
    expect(paged.pageCount).toBe(1);
    expect(paged.items).toHaveLength(0);
    expect([paged.start, paged.end]).toEqual([0, 0]);
  });
});

describe('chatPageCells', () => {
  it('lists every page when few — no gaps to explain', () => {
    expect(chatPageCells(5, 2)).toEqual([1, 2, 3, 4, 5]);
    expect(chatPageCells(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps first and last visible with a middle window and gaps', () => {
    expect(chatPageCells(12, 6)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
  });

  it('hugs the first page tightly', () => {
    // At the edge the window has no room to grow: the ellipsis follows page 2.
    expect(chatPageCells(12, 1)).toEqual([1, 2, 'gap', 12]);
    expect(chatPageCells(12, 2)).toEqual([1, 2, 3, 'gap', 12]);
  });

  it('hugs the last page tightly', () => {
    expect(chatPageCells(12, 11)).toEqual([1, 'gap', 10, 11, 12]);
    expect(chatPageCells(12, 12)).toEqual([1, 'gap', 11, 12]);
  });

  it('wants no pages when the list is empty', () => {
    expect(chatPageCells(0, 1)).toEqual([]);
  });
});
