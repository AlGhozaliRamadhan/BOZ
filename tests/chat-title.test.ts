import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CHAT_TITLE,
  fallbackChatTitle,
  normalizeGeneratedChatTitle,
} from '../src/app/chat/chat-title';

describe('chat titles', () => {
  it('uses the first user message as the immediate title', () => {
    expect(fallbackChatTitle('  Compare   BBCA and BMRI  ')).toBe('Compare BBCA and BMRI');
    expect(fallbackChatTitle()).toBe(FALLBACK_CHAT_TITLE);
  });

  it('normalizes concise model-generated titles', () => {
    expect(normalizeGeneratedChatTitle('Chat title: "BBCA vs BMRI Outlook"')).toBe('BBCA vs BMRI Outlook');
    expect(normalizeGeneratedChatTitle('   ')).toBeNull();
  });
});
