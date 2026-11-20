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
 * Language that orders an artefact, as opposed to asking about a subject.
 *
 * This is the distinction the classifier actually needs, and length was only
 * ever a proxy for it — a bad one. A user reacting to an answer writes a long
 * sentence with typos and half a thesis, and it is still a question; a short
 * message can commission a whole report ("full breakdown on NVDA"). Counting
 * words made the first case look like the second: the reported follow-up ran
 * four words over a threshold, so the engine rebuilt the entire instrument
 * analysis and repeated a correction the previous answer had already made.
 *
 * So the signal is what the message asks BOZ to PRODUCE:
 *   - an artefact being ordered ("give me a breakdown", "your analysis"),
 *   - a qualifier inside that order ("give me the complete picture", "a fresh
 *     analysis"),
 *   - an imperative that frames work for BOZ ("walk me through", "lay out",
 *     "run the numbers", "pull the dashboard"),
 *   - a multi-item list, which is a brief's structure arriving already formed.
 *
 * A passing mention of a subject noun is not an order: "the jobs report came
 * in hot, what does that mean?" has the word "report" and is still a question.
 * That is why the artefact names only count when something in the sentence is
 * pointing them at BOZ.
 *
 * None of this forbids tools or depth: a question still gets whatever the
 * answer needs. It only decides whether the report shape is expected.
 */
const REQUESTS_A_REPORT = new RegExp(
  [
    // An imperative pointed at an artefact: the message is ordering work.
    String.raw`\b(?:give me|show me|send|write|run|pull|prepare|make|do)\b(?:\s+\S+){0,5}?\s+(?:a|an|the|your)?\s*(?:full\s+|complete\s+|detailed\s+|thorough\s+|fresh\s+|new\s+)?(?:analysis|breakdown|report|write-?up|deep\s+dive|teardown|picture|review)\b`,
    // The artefact claimed as BOZ's output ("your analysis of …"), which is a
    // request for one even without an imperative.
    String.raw`\byour\s+(?:full\s+|complete\s+)?(?:analysis|breakdown|report)\b`,
    // Work ordered that names no artefact.
    String.raw`\b(?:walk me through|lay (?:it |this )?out|break (?:it|this|that) down|run the numbers|run a|pull (?:the|up)|analyse|analyze|give me the (?:full|whole))\b`,
    // Structure already formed: any line that starts a list item.
    String.raw`^[ \t]*(?:[-*•]|\d+[.)])[ \t]+\S`,
  ].join('|'),
  'im',
);

/**
 * Asking for the whole thing again. The user WANTS a fresh brief here, so the
 * full pipeline and the brief shape are exactly right.
 *
 * Only unambiguous orders belong here. Phrases that merely name an artefact
 * ("full report", "deep dive") used to sit in this list, which made "is the
 * deep dive still valid?" a report request — the same subject-noun mistake the
 * commission pattern is careful to avoid. A request that names an artefact
 * without ordering one is either question-shaped (and is a question) or is a
 * bare request, which the default already treats as a report.
 */
const WANTS_NEW_REPORT =
  /\b(?:re-?run|start over|start a new|from scratch|again please|redo|re-?do|update the|update it|re-?analyz|re-?analyse)\b/i;

/** Greetings are short by nature; anything longer is probably a real request. */
const SOCIAL_MAX_WORDS = 8;

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
 * True when the message is a question rather than a request for a new report.
 *
 * Requires ALL of:
 *  - no slash command (a `/skill` invocation always wants the full brief),
 *  - no "run it again" phrasing,
 *  - no commission for an artefact (a breakdown, a full report, ordered work,
 *    or a list — see `REQUESTS_A_REPORT`),
 *  - question-shaped (a question mark, a question opener, or a question word).
 *
 * A previous answer is deliberately NOT required to classify a question. It
 * used to be, on the theory that a question needs something to ask about. In
 * practice that requirement only ever read as "not the first message of a
 * chat", and the first message is exactly where a user opens with the question
 * they most want answered: "what you think about those idx that keep going
 * down" got the full brief shape — 554 words, a scan inventory and a
 * manufactured short plan — because there was no prior turn to be a follow-up
 * to. Question shape, plus whether the message orders an artefact, is the real
 * signal for whether someone wants a reply or a report.
 *
 * Length is no longer consulted. It was a proxy for "is this a brief?", and
 * the reported follow-up broke it by writing four words more than the cutoff
 * while asking a question; a brief is identified by the work it orders now,
 * not by how many words the order took to write.
 *
 * `history` still has a role outside this function: `lastAnswer` is what the
 * drafting pass carries when the message turns out to be a question.
 */
export function isPlainQuestion(
  message: string,
  _history?: readonly ChatQuestionHistory[] | undefined,
): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  if (text.startsWith('/')) return false;
  if (WANTS_NEW_REPORT.test(text)) return false;
  if (REQUESTS_A_REPORT.test(text)) return false;
  if (text.includes('?')) return true;
  if (QUESTION_OPENER.test(text)) return true;
  return QUESTION_WORD.test(text);
}

// ─── Social messages ─────────────────────────────────────────────────────────

/**
 * Greetings, thanks, and similar openers that are not a request for analysis.
 *
 * This is the case `isPlainQuestion` does not reach: a greeting carries no
 * question word, no question mark and no opener, so it stayed a report
 * request and got a likely-path table with every cell reading "none in data"
 * and an R:R of "—". The delivery contract demands a table and a first-person
 * take from every answer, so without this branch the engine manufactures an
 * empty report out of a greeting.
 *
 * Deliberately conservative: only unambiguous social openers qualify. "yes",
 * "ok", and "what about AAPL?" are excluded, because they can each be a real
 * request or a confirmation depending on context, and guessing wrong would
 * silence a user who actually wanted an answer.
 */
const SOCIAL_ONLY = new Set([
  'hi', 'hello', 'hey', 'yo', 'hiya', 'howdy', 'sup', 'greetings',
  'hi there', 'hey there', 'hello there',
  'good morning', 'good evening', 'good afternoon', 'morning', 'evening',
  'bye', 'goodbye', 'see you', 'see ya', 'later', 'cya',
  'thanks', 'thank you', 'thx', 'ty', 'cheers', 'appreciate it',
  'ok thanks', 'thanks!', 'thank you!',
  'who are you', 'what are you', 'what can you do', 'who r u', 'wyd',
]);

/**
 * An unambiguous social opener, optionally followed by punctuation.
 *
 * Deliberately narrow. Acknowledgements like "ok", "sure", "cool", "yeah", and
 * "nice" are NOT here: each is a plausible answer to a question BOZ just asked,
 * and treating one as small talk would swallow a real reply. They appear in
 * `SOCIAL_ONLY` only where the whole phrase is unambiguous ("ok thanks").
 */
const SOCIAL_SHAPE =
  /^(?:hi|hello|hey|yo|hiya|howdy|sup|greetings|bye|goodbye|thanks|thank\s*you|thx|ty|cheers)\b[\s!.,]*$/i;

export function isSocialMessage(message: string): boolean {
  const text = (message ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/, '')
    .trim();
  if (!text) return false;
  if (text.startsWith('/')) return false;
  if (SOCIAL_ONLY.has(text)) return true;
  if (wordCount(text) > SOCIAL_MAX_WORDS) return false;
  // Anything carrying a question mark or a question word is a real question,
  // however it opens ("hi, why is AAPL down?").
  if (text.includes('?') || QUESTION_WORD.test(text)) return false;
  return SOCIAL_SHAPE.test(text);
}

/**
 * True when the message needs none of the report machinery: a social opener, or
 * a question.
 *
 * Both get the same pipeline treatment — skip the forced research chain, drop
 * the brief delivery contract — for different reasons, so the engine branches
 * once here rather than in three places downstream.
 */
export function needsOnlyConversation(
  message: string,
  history: readonly ChatQuestionHistory[] | undefined,
): boolean {
  return isSocialMessage(message) || isPlainQuestion(message, history);
}