// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatQuestionComposer from '../src/app/chat/ChatQuestionComposer';
import { createMarketFollowUp, SKIPPED_ANSWER } from '../src/shared/chat-follow-up';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text))!;
const click = async (element: HTMLElement) => { await act(() => element.click()); };
const type = async (text: string) => {
  const textarea = container.querySelector('textarea')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('question composer interactions', () => {
  it('requires an answer and sends the custom text only once', async () => {
    const submit = vi.fn();
    await act(() => root.render(<ChatQuestionComposer followUp={createMarketFollowUp()} onSubmit={submit} onDismiss={vi.fn()} />));
    expect(button('Continue').disabled).toBe(true);
    await type('Japan, and I am open to ideas');
    await click(button('Continue'));
    await click(button('Continue'));
    expect(submit).toHaveBeenCalledExactlyOnceWith(['Japan, and I am open to ideas']);
  });

  it('preserves choices and custom text when going back through multiple questions', async () => {
    const followUp = createMarketFollowUp();
    followUp.questions.push({ id: 'horizon', title: 'How long do you want to hold?', options: [{ label: 'A few days' }] });
    const submit = vi.fn();
    await act(() => root.render(<ChatQuestionComposer followUp={followUp} onSubmit={submit} onDismiss={vi.fn()} />));
    await click(button('US stocks'));
    await click(button('Next'));
    await type('Next month, maybe longer');
    await click(container.querySelector('[aria-label="Previous question"]')!);
    expect(button('US stocks').getAttribute('aria-pressed')).toBe('true');
    await click(button('Next'));
    expect(container.querySelector('textarea')!.value).toBe('Next month, maybe longer');
    await click(button('Continue'));
    expect(submit).toHaveBeenCalledExactlyOnceWith(['US stocks', 'Next month, maybe longer']);
  });

  it('skips a question without blocking the next one and allows dismissal without submitting', async () => {
    const followUp = createMarketFollowUp();
    followUp.questions.push({ id: 'focus', title: 'Any particular focus?', options: [] });
    const submit = vi.fn();
    const dismiss = vi.fn();
    await act(() => root.render(<ChatQuestionComposer followUp={followUp} onSubmit={submit} onDismiss={dismiss} />));
    await click(button('Skip question'));
    await type('Banks');
    await click(button('Continue'));
    expect(submit).toHaveBeenCalledExactlyOnceWith([SKIPPED_ANSWER, 'Banks']);
    await act(() => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('does not submit blank text or an Enter key used to compose an IME character', async () => {
    const submit = vi.fn();
    await act(() => root.render(<ChatQuestionComposer followUp={createMarketFollowUp()} onSubmit={submit} onDismiss={vi.fn()} />));
    await type('   ');
    expect(button('Continue').disabled).toBe(true);
    await type('日本');
    await act(() => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(submit).not.toHaveBeenCalled();
  });
});
