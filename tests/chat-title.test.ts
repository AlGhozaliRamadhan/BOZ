import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CHAT_TITLE,
  ensureUniqueChatTitle,
  fallbackChatTitle,
  normalizeGeneratedChatTitle,
} from '../src/shared/chat-title';

describe('chat titles', () => {
  it('uses the first user message as the immediate title', () => {
    expect(fallbackChatTitle('  Compare   BBCA and BMRI  ')).toBe('Compare BBCA and BMRI');
    expect(fallbackChatTitle()).toBe(FALLBACK_CHAT_TITLE);
  });

  it('normalizes concise model-generated titles', () => {
    expect(normalizeGeneratedChatTitle('Chat title: "BBCA vs BMRI Outlook"')).toBe('BBCA vs BMRI Outlook');
    expect(normalizeGeneratedChatTitle('   ')).toBeNull();
  });

  it('keeps titles short, specific, and unique', () => {
    expect(ensureUniqueChatTitle('BBCA vs BMRI Outlook', [])).toBe('BBCA vs BMRI Outlook');
    expect(ensureUniqueChatTitle('BBCA vs BMRI Outlook', ['bbca vs bmri outlook'])).toBe(
      'BBCA vs BMRI Outlook (2)',
    );
    expect(
      ensureUniqueChatTitle('BBCA vs BMRI Outlook', ['BBCA vs BMRI Outlook', 'BBCA vs BMRI Outlook (2)']),
    ).toBe('BBCA vs BMRI Outlook (3)');
  });
});
