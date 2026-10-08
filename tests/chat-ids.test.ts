import { describe, expect, it } from 'vitest';
import {
  SESSION_ID_PATTERN,
  createSessionId,
  sessionNeedsTitle,
} from '../src/app/chat/_lib/chat-ids';
import {
  sanitizeSessionId,
  upsertSession,
  type ChatSessionStorage,
} from '../src/app/chat/_lib/chat-sessions';
import { fallbackChatTitle } from '../src/shared/chat-title';

function fakeStorage(): ChatSessionStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('session ids', () => {
  it('mints UUID v4 ids (opaque, Qwen-style) — never timestamp-derived', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = createSessionId();
      expect(id).toMatch(SESSION_ID_PATTERN);
      expect(id.startsWith('chat-')).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(100);
  });

  it('minted ids pass the session store sanitizer', () => {
    for (let i = 0; i < 10; i++) {
      const id = createSessionId();
      expect(sanitizeSessionId(id)).toBe(id);
    }
  });

  it('legacy chat-prefixed ids still sanitize (no migration needed)', () => {
    expect(sanitizeSessionId('chat-muyaezoe-2271414k')).toBe('chat-muyaezoe-2271414k');
  });
});

describe('sessionNeedsTitle', () => {
  it('flags a fallback-titled session with a completed reply', () => {
    const storage = fakeStorage();
    const userContent = 'analyze NVDA intraday setup';
    upsertSession(storage, {
      id: 's1',
      title: fallbackChatTitle(userContent),
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: 'flat read', status: 'done' },
      ],
      updatedAt: 0,
    });
    const need = sessionNeedsTitle(storage, 's1');
    expect(need?.user.content).toBe(userContent);
    expect(need?.assistant.content).toBe('flat read');
  });

  it('flags a "New Chat" title with a completed reply', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 's2',
      title: 'New Chat',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', status: 'done' },
      ],
      updatedAt: 0,
    });
    expect(sessionNeedsTitle(storage, 's2')).not.toBeNull();
  });

  it('accepts legacy status-less assistant messages as completed', () => {
    const storage = fakeStorage();
    const userContent = 'scan IDX momentum';
    upsertSession(storage, {
      id: 's3',
      title: fallbackChatTitle(userContent),
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: 'legacy reply' },
      ],
      updatedAt: 0,
    });
    expect(sessionNeedsTitle(storage, 's3')?.assistant.content).toBe('legacy reply');
  });

  it('returns null once a generated title has landed', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 's4',
      title: 'NVDA Pullback Watch',
      messages: [
        { role: 'user', content: 'analyze NVDA intraday setup' },
        { role: 'assistant', content: 'flat read', status: 'done' },
      ],
      updatedAt: 0,
    });
    expect(sessionNeedsTitle(storage, 's4')).toBeNull();
  });

  it('returns null with no completed assistant reply yet', () => {
    const storage = fakeStorage();
    const userContent = 'analyze NVDA';
    upsertSession(storage, {
      id: 's5',
      title: fallbackChatTitle(userContent),
      messages: [{ role: 'user', content: userContent }],
      updatedAt: 0,
    });
    expect(sessionNeedsTitle(storage, 's5')).toBeNull();
  });

  it('never titles from errored or interrupted replies', () => {
    for (const status of ['error', 'interrupted'] as const) {
      const storage = fakeStorage();
      const userContent = `failing case ${status}`;
      upsertSession(storage, {
        id: `s6-${status}`,
        title: fallbackChatTitle(userContent),
        messages: [
          { role: 'user', content: userContent },
          { role: 'assistant', content: 'broke', status },
        ],
        updatedAt: 0,
      });
      expect(sessionNeedsTitle(storage, `s6-${status}`)).toBeNull();
    }
  });

  it('returns null for unknown sessions and longer untitled threads qualify', () => {
    const storage = fakeStorage();
    expect(sessionNeedsTitle(storage, 'missing')).toBeNull();
    const userContent = 'first question about BBCA';
    upsertSession(storage, {
      id: 's7',
      title: fallbackChatTitle(userContent),
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: 'answer one', status: 'done' },
        { role: 'user', content: 'follow-up question' },
        { role: 'assistant', content: 'answer two', status: 'done' },
      ],
      updatedAt: 0,
    });
    // Retry is not limited to 2-message threads: a lost title is still claimed.
    expect(sessionNeedsTitle(storage, 's7')).not.toBeNull();
  });
});
