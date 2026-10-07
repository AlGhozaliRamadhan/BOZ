import { describe, expect, it } from 'vitest';
import {
  appendAssistantMessage,
  getSessionStatus,
  loadListedSessions,
  patchAssistantMessage,
  readSessions,
  reconcileInterruptedSessions,
  upsertSession,
  writeSessions,
  type ChatSessionStorage,
} from '../src/app/chat/_lib/chat-sessions';

function fakeStorage(): ChatSessionStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('chat sessions', () => {
  it('rolls up streaming while generating and done after completion', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 'chat-1',
      title: 'Test',
      messages: [{ role: 'user', content: 'hi' }],
      updatedAt: 0,
    });
    expect(getSessionStatus(readSessions(storage)[0])).toBe('streaming');

    const index = appendAssistantMessage(storage, 'chat-1', {
      role: 'assistant',
      content: '',
      status: 'streaming',
    });
    expect(index).toBe(1);
    expect(getSessionStatus(readSessions(storage)[0])).toBe('streaming');

    expect(
      patchAssistantMessage(storage, 'chat-1', index, {
        content: 'done reply',
        status: 'done',
      }),
    ).toBe(true);
    expect(getSessionStatus(readSessions(storage)[0])).toBe('done');
  });

  it('never lets terminal status leave terminal', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 'chat-2',
      title: 'Test',
      messages: [{ role: 'assistant', content: 'x', status: 'done' }],
      updatedAt: 0,
    });
    expect(patchAssistantMessage(storage, 'chat-2', 0, { status: 'streaming' })).toBe(false);
  });

  it('reconcile skips live streams and marks orphaned streaming as interrupted', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 'live',
      title: 'Live',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial', status: 'streaming' },
      ],
      updatedAt: 0,
    });
    upsertSession(storage, {
      id: 'orphan',
      title: 'Orphan',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial', status: 'streaming' },
      ],
      updatedAt: 0,
    });

    const first = reconcileInterruptedSessions(
      readSessions(storage),
      (id) => id === 'live',
      123,
    );
    expect(first.changed).toBe(true);
    const orphan = first.sessions.find((s) => s.id === 'orphan')!;
    expect(getSessionStatus(orphan)).toBe('interrupted');
    expect(first.sessions.find((s) => s.id === 'live')!.status).toBe('streaming');

    // Idempotent: second pass with the same liveness changes nothing.
    const second = reconcileInterruptedSessions(
      first.sessions,
      (id) => id === 'live',
      124,
    );
    expect(second.changed).toBe(false);
  });

  it('reconcile pushes a paused reply when only a user message remains', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 'user-only',
      title: 'User only',
      messages: [{ role: 'user', content: 'hello' }],
      updatedAt: 0,
    });
    const result = reconcileInterruptedSessions(readSessions(storage), () => false, 999);
    expect(result.changed).toBe(true);
    const session = result.sessions.find((s) => s.id === 'user-only')!;
    expect(session.messages.length).toBe(2);
    expect(session.messages[1].status).toBe('interrupted');
  });

  it('loadListedSessions sorts newest first without touching storage', () => {
    const storage = fakeStorage();
    writeSessions(storage, [
      {
        id: 'old',
        title: 'Old',
        messages: [{ role: 'assistant', content: 'done', status: 'done' }],
        updatedAt: 100,
      },
      {
        id: 'new',
        title: 'New',
        messages: [{ role: 'assistant', content: 'done', status: 'done' }],
        updatedAt: 200,
      },
    ]);
    const before = storage.getItem('boz_chat_sessions');
    const listed = loadListedSessions(storage, () => false, false);
    expect(listed.map((s) => s.id)).toEqual(['new', 'old']);
    expect(storage.getItem('boz_chat_sessions')).toBe(before);
  });

  it('loadListedSessions with reconcile heals orphans but keeps live streams', () => {
    const storage = fakeStorage();
    upsertSession(storage, {
      id: 'live',
      title: 'Live',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial', status: 'streaming' },
      ],
      updatedAt: 0,
    });
    upsertSession(storage, {
      id: 'orphan',
      title: 'Orphan',
      messages: [{ role: 'user', content: 'q' }],
      updatedAt: 0,
    });
    const listed = loadListedSessions(storage, (id) => id === 'live', true);
    expect(getSessionStatus(listed.find((s) => s.id === 'live')!)).toBe('streaming');
    expect(getSessionStatus(listed.find((s) => s.id === 'orphan')!)).toBe('interrupted');
    // Healing persists, so a later refresh keeps the interrupted status.
    const stored = readSessions(storage);
    expect(getSessionStatus(stored.find((s) => s.id === 'orphan')!)).toBe('interrupted');
  });
});
