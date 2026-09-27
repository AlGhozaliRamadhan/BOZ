// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComponent from '../src/app/chat/ChatComponent';
import { createMarketFollowUp } from '../src/shared/chat-follow-up';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('../src/app/chat/ChatModelPicker', () => ({ default: () => null }));
vi.mock('../src/app/chat/ChatEffortPicker', () => ({ default: () => null }));
vi.mock('../src/app/components/ui/ThoughtAccordion', () => ({ ThoughtAccordion: () => null }));

let container: HTMLDivElement;
let root: Root;
let responses: string[];
let requests: any[];
const questions = createMarketFollowUp();
const questionEvent = `event: follow_up\ndata: ${JSON.stringify({ followUp: questions })}\n\n`;
const doneEvent = 'event: done\ndata: {}\n\n';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  responses = [];
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/chat/stream') return Response.json({});
    requests.push(JSON.parse(init!.body as string));
    // Split even SSE field names and JSON across chunks, as real transports can.
    const chunks = [...(responses.shift() ?? doneEvent)];
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }));
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
const type = async (selector: string, text: string) => {
  await act(() => {
    const textarea = container.querySelector<HTMLTextAreaElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = async (selector: string) => { await act(async () => { container.querySelector<HTMLButtonElement>(selector)!.click(); }); };

describe('chat composer question lifecycle', () => {
  it('handles fragmented question events without an empty-response error and resumes with original context', async () => {
    responses.push(questionEvent + doneEvent, 'event: token\ndata: "I will use your custom scope."\n\n' + doneEvent);
    await act(() => root.render(<ChatComponent chatId="question-test" />));
    await type('.chat-composer-textarea', 'Find oversold opportunities for next month');
    await click('[aria-label="Send message"]');
    expect(container.querySelector('.chat-composer .chat-question-panel')).not.toBeNull();
    expect(container.querySelector('.chat-messages')!.textContent).not.toContain(questions.questions[0].title);
    expect(container.querySelector('.chat-bubble.assistant')!.textContent).toContain('One quick detail before I continue');
    expect(container.querySelector('.chat-messages')!.textContent).not.toContain('paused');
    expect(container.querySelector('.chat-composer-textarea')).toBeNull();
    await type('.chat-question-custom-input', 'Japanese banks, no preset please');
    await click('.chat-question-continue');
    expect(requests).toHaveLength(2);
    expect(requests[1].message).toContain('Japanese banks, no preset please');
    expect(requests[1].history[0].content).toBe('Find oversold opportunities for next month');
    expect(requests[1].history[1].content).toContain(questions.questions[0].title);
    expect(container.querySelector('.chat-question-panel')).toBeNull();
    expect(container.textContent).toContain('I will use your custom scope.');
    expect([...container.querySelectorAll('.chat-bubble')].map(element => element.classList.contains('assistant') ? 'assistant' : 'user')).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('persists dismissal of a legacy picker and restores the normal input', async () => {
    localStorage.setItem('boz_chat_sessions', JSON.stringify([{ id: 'legacy', title: 'Legacy', messages: [
      { role: 'user', content: 'Find picks' },
      { role: 'assistant', content: 'Pick a market below', followUp: { kind: 'screener-market', horizon: 'month', preset: 'rebound', mode: 'fast' } },
    ] }]));
    await act(() => root.render(<ChatComponent chatId="legacy" />));
    expect(container.querySelector('.chat-question-panel')).not.toBeNull();
    await click('[aria-label="Dismiss questions"]');
    expect(container.querySelector('.chat-question-panel')).toBeNull();
    expect(container.querySelector('.chat-composer-textarea')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('boz_chat_sessions')!)[0].messages[1].followUpDismissed).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('does not activate questions from an interrupted stream', async () => {
    responses.push(questionEvent);
    await act(() => root.render(<ChatComponent chatId="interrupted" />));
    await type('.chat-composer-textarea', 'Find some ideas');
    await click('[aria-label="Send message"]');
    expect(container.querySelector('.chat-question-panel')).toBeNull();
    expect(container.querySelector('.chat-composer-textarea')).not.toBeNull();
  });
});
