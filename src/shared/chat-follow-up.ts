/** Serializable questions shared by the chat engine, saved sessions, and composer. */
export interface ChatQuestion {
  id: string;
  title: string;
  options: Array<{ label: string; description?: string }>;
}

export interface ChatFollowUp {
  kind: 'questions';
  questions: ChatQuestion[];
}

export const MAX_CUSTOM_ANSWER_CHARS = 2000;
export const SKIPPED_ANSWER = 'No preference. Use your judgment and explain any assumption.';

export function followUpIntroduction(followUp: ChatFollowUp): string {
  return followUp.questions.length === 1
    ? 'One quick detail before I continue. Choose an option below, or tell me in your own words.'
    : 'A couple of details will help me tailor this. Choose below, or answer in your own words.';
}

export function displayAssistantContent(message: { content: string; followUp?: unknown; suggestions?: unknown }): string {
  const followUp = readMessageFollowUp(message);
  return message.content || (followUp ? followUpIntroduction(followUp) : '');
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

/** Reject malformed model/stream/storage data before it can become interactive UI. */
export function parseChatFollowUp(value: unknown): ChatFollowUp | null {
  if (!record(value) || value.kind !== 'questions' || !Array.isArray(value.questions)) return null;
  if (value.questions.length < 1 || value.questions.length > 3) return null;
  const questions: ChatQuestion[] = [];
  for (const question of value.questions) {
    if (!record(question) || !boundedText(question.id, 64) || !boundedText(question.title, 240)) return null;
    if (!Array.isArray(question.options) || question.options.length > 4) return null;
    const options: ChatQuestion['options'] = [];
    for (const option of question.options) {
      if (!record(option) || !boundedText(option.label, 120)) return null;
      if (option.description !== undefined && !boundedText(option.description, 240)) return null;
      const label = option.label.trim();
      if (options.some(existing => existing.label === label)) return null;
      options.push({ label, ...(option.description ? { description: (option.description as string).trim() } : {}) });
    }
    const id = question.id.trim();
    if (questions.some(existing => existing.id === id)) return null;
    questions.push({ id, title: question.title.trim(), options });
  }
  return { kind: 'questions', questions };
}

export function createMarketFollowUp(): ChatFollowUp {
  return {
    kind: 'questions',
    questions: [{
      id: 'market',
      title: 'Which market do you have in mind?',
      options: [
        { label: 'US stocks', description: 'NYSE and Nasdaq' },
        { label: 'Indonesian stocks', description: 'IDX' },
        { label: 'Crypto', description: 'Bitcoin and other major coins' },
        { label: 'Help me choose', description: 'Compare the markets first' },
      ],
    }],
  };
}

/** Older local sessions used dedicated market and ticker suggestion payloads. */
export function readMessageFollowUp(message: { followUp?: unknown; suggestions?: unknown }): ChatFollowUp | null {
  const parsed = parseChatFollowUp(message.followUp);
  if (parsed) return parsed;
  if (record(message.followUp) && message.followUp.kind === 'screener-market') return createMarketFollowUp();
  if (Array.isArray(message.suggestions) && message.suggestions.length) {
    const options = message.suggestions.slice(0, 4).flatMap(suggestion =>
      record(suggestion) && boundedText(suggestion.symbol, 120)
        ? [{ label: suggestion.symbol, ...(boundedText(suggestion.name, 240) ? { description: suggestion.name } : {}) }]
        : []);
    return parseChatFollowUp({ kind: 'questions', questions: [{ id: 'ticker', title: 'Which ticker did you mean?', options }] });
  }
  return null;
}

export function formatFollowUpAnswers(followUp: ChatFollowUp, answers: string[]): string {
  if (answers.length !== followUp.questions.length || answers.some(answer => !answer.trim() || answer.length > MAX_CUSTOM_ANSWER_CHARS)) {
    throw new Error('Answer each question before continuing.');
  }
  return `My answers:\n${followUp.questions.map((question, index) => `${question.title}\n${answers[index].trim()}`).join('\n\n')}`;
}

/** Only the latest assistant turn can request input; answered/dismissed prompts stay closed. */
export function getActiveFollowUp(messages: Array<{ role: string; followUp?: unknown; suggestions?: unknown; followUpDismissed?: boolean }>) {
  const index = messages.length - 1;
  const message = messages[index];
  if (!message || message.role !== 'assistant' || message.followUpDismissed) return null;
  const followUp = readMessageFollowUp(message);
  return followUp ? { index, followUp } : null;
}

export function followUpHistoryContent(message: { content: string; followUp?: unknown; suggestions?: unknown; followUpDismissed?: boolean }): string {
  const followUp = readMessageFollowUp(message);
  if (!followUp) return message.content;
  const questions = followUp.questions.map(question => [
    question.title,
    ...question.options.map(option => `- ${option.label}${option.description ? `: ${option.description}` : ''}`),
  ].join('\n')).join('\n\n');
  return [message.content, `Questions asked in the composer:\n${questions}`, message.followUpDismissed ? 'The user dismissed these questions; continue from their next message without repeating them.' : ''].filter(Boolean).join('\n\n');
}

export const askUserQuestionsDefinition = {
  type: 'function',
  function: {
    name: 'ask_user_questions',
    description: 'Ask 1–3 short questions in the chat input when a missing preference or ambiguous ticker materially changes the work. This pauses the turn. Ask only what the conversation has not answered. The UI always adds a custom text answer; do not add an Other option. Use zero options for a free-text question.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string', maxLength: 400,
          description: 'A short, finished assistant message acknowledging the request and introducing the questions. This stays in the chat transcript. Keep the actual question choices in questions, not in this message.',
        },
        questions: {
          type: 'array', minItems: 1, maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', maxLength: 64 },
              title: { type: 'string', maxLength: 240 },
              options: {
                type: 'array', maxItems: 4,
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', maxLength: 120 },
                    description: { type: 'string', maxLength: 240 },
                  },
                  required: ['label'], additionalProperties: false,
                },
              },
            },
            required: ['id', 'title', 'options'], additionalProperties: false,
          },
        },
      },
      required: ['message', 'questions'], additionalProperties: false,
    },
  },
};
