import { describe, expect, it } from 'vitest';
import {
  CHAT_DRAFT_PREFIX,
  chatDraftKey,
  clearChatDraft,
  readChatDraft,
  writeChatDraft,
  type ChatDraftStorage,
} from '../src/app/chat/_lib/chat-draft.js';

/** Same shape as sessionStorage, without a browser. */
function storage(): ChatDraftStorage & { dump(): Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    removeItem: (key) => {
      delete store[key];
    },
    dump: () => ({ ...store }),
  };
}

describe('chat drafts', () => {
  it('keys the unsaved composer and a saved chat separately', () => {
    // The first send swaps /chat for /chat/<id>. If both shared a key, the
    // sent text (cleared) and the next draft (typed during the answer) would
    // overwrite each other across that route change.
    expect(chatDraftKey(undefined)).toBe(`${CHAT_DRAFT_PREFIX}new`);
    expect(chatDraftKey('abc123')).toBe(`${CHAT_DRAFT_PREFIX}abc123`);
    expect(chatDraftKey('')).toBe(`${CHAT_DRAFT_PREFIX}new`);
  });

  it('keeps a draft in the conversation it was typed in', () => {
    const store = storage();
    writeChatDraft(store, 'chat-a', 'NVDA broke the shelf, ');
    writeChatDraft(store, 'chat-b', 'what about BBCA?');

    expect(readChatDraft(store, 'chat-a')).toBe('NVDA broke the shelf, ');
    expect(readChatDraft(store, 'chat-b')).toBe('what about BBCA?');
    expect(readChatDraft(store, 'chat-c')).toBe('');
  });

  it('survives a remount or reload: the text outlives the component', () => {
    // The bug being fixed was state living only in useState. Nothing here has
    // a component: the second read is a fresh handle over the same storage.
    const store = storage();
    writeChatDraft(store, 'chat-a', 'half a question');
    const afterReload = storage();
    for (const [key, value] of Object.entries(store.dump())) afterReload.setItem(key, value);

    expect(readChatDraft(afterReload, 'chat-a')).toBe('half a question');
  });

  it('deletes the draft when the text is cleared, so sending cannot resurrect it', () => {
    const store = storage();
    writeChatDraft(store, 'chat-a', 'about to send');
    writeChatDraft(store, 'chat-a', '');

    expect(readChatDraft(store, 'chat-a')).toBe('');
    expect(store.dump()).toEqual({});
  });

  it('clears through the explicit helper as well', () => {
    const store = storage();
    writeChatDraft(store, 'chat-a', 'text');
    clearChatDraft(store, 'chat-a');
    expect(store.dump()).toEqual({});
  });

  it('keeps typing working when storage is unavailable', () => {
    const broken: ChatDraftStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); },
    };

    expect(() => writeChatDraft(broken, 'chat-a', 'text')).not.toThrow();
    expect(readChatDraft(broken, 'chat-a')).toBe('');
    expect(() => clearChatDraft(broken, 'chat-a')).not.toThrow();
  });
});
