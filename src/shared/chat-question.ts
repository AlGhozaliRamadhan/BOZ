// ─── shared/chat-question.ts ────────────────────────────────────────────────
// Was the user asking a normal question in the conversation, or asking for a
// brand-new report?
//
// This is load-bearing. Without the distinction every message after `/intraday`
// is treated as a fresh brief: the engine re-fetches the dashboard, force-arms
// the web_search/risk_calc chain, and the drafting pass — which saw only user
// messages — re-renders the whole intraday report in answer to "but it goes
// down how could you be sure about that".
//
// A plain question does NOT remove tools from the model: it only stops the
// engine from forcing the full pipeline and from demanding the brief shape. If
// the question genuinely needs fresh data, the model may still fetch it.
//
// Pure: no fs, no DOM. Safe from API routes and from client UI.

export interface ChatQuestionHistory {
  role: 'user' | 'assistant';
  content: string;
}

/** A question about something already answered is a sentence or two, not a brief. */
const QUESTION_MAX_WORDS = 40;

/**
 * How people actually open a question about something already answered: either
 * a question word ("why…") or the discourse connective that comes with one
 * ("but it goes down", "so what if", "then what happens").
 */
const QUESTION_OPENER =
  /^(?:but|so|and|then|ok|okay|alright|right|well|hmm|hm|why|how|what|when|where|which|who|whose|is|are|was|were|am|do|does|did|can|could|should|would|will|if|it|its|that|this|there|here|you|your|i|we|us|they|it\'s|doesn\'t|don\'t|isn\'t|wasn\'t|can\'t|couldn\'t|won\'t)\b/i;

/** A question word anywhere in the sentence ("…how could you be sure"). */
const QUESTION_WORD =
  /\b(?:why|how|what|when|where|which|who|whose|is|are|was|were|do|does|did|can|could|should|would|will|explain|clarify|sure|certain|confident|mean|think|feel|really|still|again|instead|unless|if)\b/i;

/**
 * Asking for the whole thing again. The user WANTS a fresh brief here, so the
 * full pipeline and the brief shape are exactly right.
 */
const WANTS_NEW_REPORT =
  /\b(?:re-?run|start over|from scratch|scratch|new analysis|fresh analysis|full analysis|full brief|full report|again please|redo|re-?do|update the|update it|re-?analyz|re-?analyse|deep dive|start a new)\b/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The most recent non-empty answer BOZ gave, or null when there is none. */
export function lastAnswer(history: readonly ChatQuestionHistory[] | undefined): string | null {
  if (!history?.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message?.role === 'assistant' && message.content?.trim()) {
      return message.content.trim();
    }
  }
  return null;
}

/**
 * True when the message is a normal question about an answer already given,
 * rather than a request for a new report.
 *
 * Requires ALL of:
 *  - there is a previous answer to ask about,
 *  - no slash command (a `/skill` invocation always wants the full brief),
 *  - no "run it again" phrasing,
 *  - short enough to be a question, not a request,
 *  - question-shaped (a question mark, a question opener, or a question word).
 */
export function isPlainQuestion(
  message: string,
  history: readonly ChatQuestionHistory[] | undefined,
): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  if (lastAnswer(history) === null) return false;
  if (text.startsWith('/')) return false;
  if (WANTS_NEW_REPORT.test(text)) return false;
  if (wordCount(text) > QUESTION_MAX_WORDS) return false;
  if (text.includes('?')) return true;
  if (QUESTION_OPENER.test(text)) return true;
  return QUESTION_WORD.test(text);
}