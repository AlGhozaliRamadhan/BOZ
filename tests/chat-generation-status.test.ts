import { describe, expect, it } from 'vitest';
import {
  canTransitionChatStatus,
  isTerminalChatStatus,
  rollupChatStatus,
} from '../src/shared/chat-generation-status';

describe('chat generation status', () => {
  it('treats trailing user message as streaming and empty thread as done', () => {
    expect(rollupChatStatus([])).toBe('done');
    expect(rollupChatStatus([{ role: 'user' }])).toBe('streaming');
    expect(
      rollupChatStatus([{ role: 'user' }, { role: 'assistant', status: 'streaming' }]),
    ).toBe('streaming');
  });

  it('counts legacy assistant messages without status as done', () => {
    expect(rollupChatStatus([{ role: 'user' }, { role: 'assistant' }])).toBe('done');
    expect(
      rollupChatStatus([{ role: 'user' }, { role: 'assistant', status: 'done' }]),
    ).toBe('done');
  });

  it('locks terminal states and allows streaming to finish', () => {
    expect(canTransitionChatStatus(undefined, 'streaming')).toBe(true);
    expect(canTransitionChatStatus('streaming', 'done')).toBe(true);
    expect(canTransitionChatStatus('streaming', 'streaming')).toBe(true);
    expect(canTransitionChatStatus('done', 'streaming')).toBe(false);
    expect(canTransitionChatStatus('error', 'done')).toBe(false);
    expect(canTransitionChatStatus('cancelled', 'interrupted')).toBe(false);
    expect(isTerminalChatStatus('interrupted')).toBe(true);
    expect(isTerminalChatStatus('streaming')).toBe(false);
  });
});
