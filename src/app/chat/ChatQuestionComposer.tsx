'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MAX_CUSTOM_ANSWER_CHARS, SKIPPED_ANSWER, type ChatFollowUp } from '@/shared/chat-follow-up';

interface AnswerDraft { choice: number | 'custom' | null; custom: string }

export default function ChatQuestionComposer({ followUp, onSubmit, onDismiss }: {
  followUp: ChatFollowUp;
  onSubmit: (answers: string[]) => void;
  onDismiss: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<AnswerDraft[]>(() => followUp.questions.map(question => ({ choice: question.options.length ? null : 'custom', custom: '' })));
  const submitted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const question = followUp.questions[index];
  const draft = drafts[index];
  const lastQuestion = index === followUp.questions.length - 1;
  const answerFor = (entry: AnswerDraft, questionIndex: number) => entry.choice === 'custom'
    ? entry.custom.trim()
    : typeof entry.choice === 'number' ? followUp.questions[questionIndex].options[entry.choice].label : '';
  const answer = answerFor(draft, index);

  useEffect(() => { headingRef.current?.focus(); }, [index]);
  useEffect(() => {
    const textarea = customRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 80)}px`;
  }, [index, draft.custom]);

  const updateDraft = (next: Partial<AnswerDraft>) => setDrafts(current => current.map((entry, questionIndex) => questionIndex === index ? { ...entry, ...next } : entry));
  const advance = (value: string) => {
    if (!value || submitted.current) return;
    if (!lastQuestion) { setIndex(index + 1); return; }
    const answers = drafts.map(answerFor);
    answers[index] = value;
    const missing = answers.findIndex(entry => !entry);
    if (missing !== -1) { setIndex(missing); return; }
    submitted.current = true;
    onSubmit(answers);
  };

  return (
    <section className="chat-question-panel" aria-labelledby={`${id}-title`} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
    }}>
      <div className="chat-question-header">
        <h2 id={`${id}-title`} className="chat-question-title" ref={headingRef} tabIndex={-1}>{question.title}</h2>
        <div className="chat-question-navigation">
          {followUp.questions.length > 1 && <>
            <button type="button" className="chat-question-icon" aria-label="Previous question" disabled={index === 0} onClick={() => setIndex(index - 1)}><i className="fa-solid fa-chevron-left" aria-hidden="true" /></button>
            <span className="chat-question-progress" aria-live="polite">{index + 1} of {followUp.questions.length}</span>
            <button type="button" className="chat-question-icon" aria-label="Next question" disabled={lastQuestion || !answer} onClick={() => setIndex(index + 1)}><i className="fa-solid fa-chevron-right" aria-hidden="true" /></button>
          </>}
          <button type="button" className="chat-question-icon" aria-label="Dismiss questions" title="Return to your message" onClick={onDismiss}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="chat-question-body">
        <div className="chat-question-options">
          {question.options.map((option, optionIndex) => (
            <button key={option.label} type="button" className="chat-question-option" aria-pressed={draft.choice === optionIndex} onClick={() => updateDraft({ choice: optionIndex })}>
              <span className="chat-question-number" aria-hidden="true">{draft.choice === optionIndex ? <i className="fa-solid fa-check" /> : optionIndex + 1}</span>
              <span className="chat-question-option-copy"><span>{option.label}</span>{option.description && <span className="chat-question-description">{option.description}</span>}</span>
            </button>
          ))}
        </div>
        <div className={`chat-question-custom ${draft.choice === 'custom' ? 'is-selected' : ''}`}>
          <button type="button" className="chat-question-custom-choice" aria-label="Use a custom answer" aria-pressed={draft.choice === 'custom'} onClick={() => { updateDraft({ choice: 'custom' }); customRef.current?.focus(); }}><i className="fa-solid fa-pencil" aria-hidden="true" /></button>
          <textarea ref={customRef} className="chat-question-custom-input" aria-label={`Custom answer: ${question.title}`} placeholder="Something else…" rows={1} maxLength={MAX_CUSTOM_ANSWER_CHARS} value={draft.custom} onFocus={() => updateDraft({ choice: 'custom' })} onChange={event => updateDraft({ choice: 'custom', custom: event.target.value })} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); advance(draft.custom.trim()); }
          }} />
        </div>
      </div>
      <div className="chat-question-footer">
        <button type="button" className="chat-question-skip" onClick={() => { updateDraft({ choice: 'custom', custom: SKIPPED_ANSWER }); advance(SKIPPED_ANSWER); }}>Skip{followUp.questions.length > 1 ? ' question' : ''}</button>
        <button type="button" className="chat-question-continue" disabled={!answer} onClick={() => advance(answer)}>{lastQuestion ? 'Continue' : 'Next'}<i className="fa-solid fa-arrow-right" aria-hidden="true" /></button>
      </div>
    </section>
  );
}
