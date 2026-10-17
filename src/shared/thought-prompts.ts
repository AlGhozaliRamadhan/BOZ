// Analysis directives for chat models. Effort buys more verification and more
// independent checks, and BOZ SHOWS the working rather than describing it.
//
// Why this asks for visible reasoning: the thought panel used to be filled with
// BOZ's own canned sentences — `buildAiRead` picked between hardcoded phrasings
// per tool and spliced the result's numbers into them. That rendered as the
// model thinking while being a template. Two ways to get the real thing, and
// both are used: providers with a native reasoning channel (DeepSeek-R1, QwQ,
// Anthropic extended thinking) stream it directly, and providers without one
// are asked for it in `<thinking>` tags, which the engine routes to the same
// panel instead of discarding.
//
// The line that matters: reasoning is the model's, not ours. BOZ never authors
// a sentence that purports to be the model's thinking, and no fixed skeleton of
// sections or headers is mandated for the answer.
//
// The directives below are written as GUIDANCE, not as a rulebook, and that is a
// deliberate reversal. They used to be a wall: uppercase section headers,
// `(1)…(5) ALWAYS present`, ban lists, an em-dash quota, a hard word cap. A
// model reasoning under that spends its visible thinking negotiating it — the
// user was reading "the contract says …", "word count ≤350", "the rule bans a
// full row of dashes" instead of an analysis. Two changes fixed it:
//
//   1. State each rule once. The number rule, the delivery shape and ownership
//      were each restated three or four times across the prompt stack; every
//      copy was another rule to hold in mind, and the thinking panel is where
//      holding them showed.
//   2. Say the destination, not the procedure. Where a shape can be checked in
//      code it is not negotiated in prose: `answerCheck` already rejects a
//      missing table, missing Entry/Stop/TP columns, a missing first-person
//      take, a label-stamp opener, a no-trade refusal and a truncated final
//      sentence, then regenerates with the findings attached. Duplicating those
//      rules in the prompt bought nothing and cost the reasoning budget.
//
// What no code can check stays, because it is integrity rather than formatting:
// numbers traceable to tool output, missing data stated as missing, no invented
// probabilities, market evidence as the reason, and never handing the model's
// own work back to the user.

export type ThoughtEffort = 'Low' | 'Medium' | 'High' | 'Extra' | 'Max';

/**
 * Which relaxation, if any, applies to the message being answered.
 *
 * `'social'` is a greeting, `'question'` is a follow-up on the previous
 * answer. Both mean the answer is a reply rather than a brief, and the visible
 * thinking has to match the message instead of running the analysis ladder at it.
 */
export type ConversationalKind = 'social' | 'question' | null;

/**
 * The shared contract every tier carries.
 *
 * Stated once so a tier block cannot drift into contradicting it. The first
 * clause is why the tags exist at all; the second is what keeps the block about
 * the problem instead of about the prompt.
 */
const THINK_VISIBLE_CONTRACT = [
  'HOW TO THINK:',
  '  Put your working in a single <thinking>...</thinking> block, before the answer.',
  '  If the platform gives you a native thinking or reasoning mode, use it instead — do not duplicate it in tags.',
  '  Write it the way you would think out loud: what the user is actually asking for, what you already know,',
  '  which of your tools would settle it, what each tool result changed, and what you will do next.',
  '  Move forward as you go. A block that opens by re-describing the question, re-listing what you already',
  '  fetched, or asking again what you decided to do is time the reader spent on nothing: the request is',
  '  already established, so start from what just changed and go to the conclusion it implies.',
  '  Think about the market, not about the writing. Announcing your own word budget, re-reading the',
  '  instructions, listing the sections you are about to produce, or saying "let me re-run X" when you are',
  '  about to re-run X are all narration the reader did not ask for — do the thing instead of describing it.',
  '  A number you already have is a number you stop asking for. If a figure was returned, use it or drop it;',
  '  do not re-derive it to be sure of it.',
  '  The user READS this block verbatim. Keep it about the problem — it is not the place to restate these',
  '  instructions, count what you have to deliver, or argue with a format rule. A block that recites the',
  '  system prompt is the failure mode, not the good one.',
  '  Scale it to the message. A greeting or a one-line question gets a sentence or two, not an audit.',
  '  Be honest rather than tidy. The block is separated from the answer automatically, so nothing outside it',
  '  except the answer itself.',
].join('\n');

/**
 * Thinking directive for a message that is not an analysis request.
 *
 * A greeting has no ticker, no evidence and nothing to verify. Handed the
 * analysis tiers it produces the visible failure this replaces: a full audit of
 * the delivery contract recited inside the thinking panel for the word "hi".
 * The block stays (BOZ shows thinking, that policy is not being walked back) —
 * it just has to be about the message.
 */
const CONVERSATIONAL_THOUGHT_PROMPT = [
  'HOW TO THINK:',
  '  Put your working inside a single <thinking>...</thinking> block, before the answer.',
  '  If the platform gives you a native thinking or reasoning mode, use it instead — do not duplicate it in tags.',
  '  One or two sentences of plain prose: what the user wants, and how you will answer it.',
  '  No market read, no tool plan, no checklist, no restatement of these instructions, and no section labels.',
  '  The block is separated from the answer automatically. Never put anything outside it except the answer itself.',
].join('\n');

export const THOUGHT_PROMPTS: Record<ThoughtEffort, string> = {
  Low: `\n\n[ANALYSIS DIRECTIVE — LOW]:
Check the central claim against the available facts, identify the next useful action, and state the key condition that would make it wrong.
${THINK_VISIBLE_CONTRACT}
Return only the concise user-facing answer or the required tool call.`,

  Medium: `\n\n[ANALYSIS DIRECTIVE — MEDIUM]:
Evaluate market context, technical confluence, catalysts, and the action plan before responding. Test the leading conclusion against one plausible alternative.
Check that every important number is grounded, each causal claim follows from the evidence, and the recommendation names its invalidation condition.
${THINK_VISIBLE_CONTRACT}
Return only the concise user-facing answer or the required tool call.`,

  High: `\n\n[ANALYSIS DIRECTIVE — HIGH]:
Work through technical structure, momentum, volatility, catalysts, sentiment, and risk. Trace each material conclusion to the strongest available evidence.
Stress-test the proposed action against the strongest contrary evidence, delete any figure you cannot trace to tool output, and state what data remains unknown before deciding.
${THINK_VISIBLE_CONTRACT}
Return only the concise user-facing answer or the required tool call.`,

  Extra: `\n\n[ANALYSIS DIRECTIVE — EXTRA]:
Cross-check the evidence across technical, macro, catalyst, sentiment, and risk channels, weighting sources by relevance and recency.
Resolve disagreements, keep only figures traceable to tool output, test at least one alternative explanation, and avoid treating correlation as proof.
${THINK_VISIBLE_CONTRACT}
Return only the concise user-facing answer or the required tool call.`,

  Max: `\n\n[ANALYSIS DIRECTIVE — MAX]:
Verify exhaustively: audit the key figures, compare timeframes, test the leading conclusion against the strongest contrary evidence, and identify the decisive invalidation condition. Rank the evidence by decision impact and reconcile conflicting signals explicitly.
Depth changes the quality of the internal work, not the length of the visible response.
${THINK_VISIBLE_CONTRACT}
Return only the concise user-facing answer or the required tool call.`,
};

export function getThoughtPrompt(
  effort: ThoughtEffort = 'High',
  conversational: ConversationalKind = null,
): string {
  if (conversational === 'social') return CONVERSATIONAL_THOUGHT_PROMPT;
  return THOUGHT_PROMPTS[effort] || THOUGHT_PROMPTS.High;
}

/**
 * Reasoning pass for a message that is not an analysis request.
 *
 * The full pass prompt is a delivery contract, and a model reasoning under it
 * will — correctly — talk about the contract. That is what the user was reading
 * for the word "hi": a paragraph weighing the likely-path table against a rule
 * banning an all-dash row. A greeting gets two phases and nothing else.
 */
const CONVERSATIONAL_REASONING_PASS_PROMPT = `
[CONVERSATIONAL ANSWER PASS]:
Two phases. Phase 1 — reasoning: use the platform's native thinking mode if one exists; if it does not, put your working in a <thinking>...</thinking> block. One or two sentences of plain prose about what the user actually wants and how you will reply. Keep it about them: naming a rule, a limit or a format is the one thing that makes it read like paperwork. Phase 2 — final answer: stands alone, in a sentence or two, the way a person answers a greeting.
There is no instrument in this message, so there is nothing to research and no decision to hand back. That is the whole shape of the work here, and a short warm reply is a complete answer.`;

/**
 * The analysis pass.
 *
 * Rewritten from a ~1,400-word output spec down to a few hundred words of
 * guidance. What was cut and why:
 *
 *   - The enumerated `(1)…(5) ALWAYS present` skeleton. A model handed a
 *     template produces the template on a wait day and on a breakout day alike,
 *     which is the sameness the old prompt complained about while mandating it.
 *     "Reach the call before you reach for a shape" leads instead.
 *   - Ban lists, the em-dash quota, the word cap and the "non-negotiable" /
 *     "no exemptions" / "NO third path" vocabulary. None of it is checkable in
 *     code, and all of it is what the model quoted back in the thinking panel.
 *   - `FRESH WORDS EVERY RUN`, which instructed variety in the imperative while
 *     a worked example in `RUNTIME_SYSTEM_PROMPT` demonstrates it far better.
 *
 * What stayed is what no gate can check: the number rule, missing data stated as
 * missing, no invented probabilities, evidence as the reason for a conclusion,
 * plan testing through risk_calc, silent verification, and one render.
 */
export function getReasoningPassPrompt(
  effort: ThoughtEffort = 'High',
  conversational: ConversationalKind = null,
): string {
  if (conversational) return CONVERSATIONAL_REASONING_PASS_PROMPT;
  return `\n\n[${effort.toUpperCase()} ANALYSIS PASS]:
Two phases. Phase 1 — do the work where it can be seen: what the user is actually asking, what you already know, which tool would settle it, what each result changed, what you will do next. Use the platform's native thinking or reasoning mode if it has one; otherwise put that working in a single <thinking>...</thinking> block. The user reads the block, so it stays about the problem — never a recital of these instructions, never an audit of the format rules, and never a running commentary on your own drafting ("word cap 350, let me write", "now re-running the calc to check"). Phase 2 — the answer, standing on its own.

Reach the call before you reach for a shape. Long, short, or waiting; how sure you are; the one thing that would change your mind. Whatever you find then decides what the answer looks like — a clean break, a conflicted tape and a wait should not read alike, and the same layout every day is a failed answer even when the numbers hold. risk_calc settles the math, never the conviction.

Open with that call in your own words, a sentence rather than a stamp, then only the facts that actually moved it, each number appearing once. The question sets the depth: work out what would actually resolve what was asked before deciding how much of it to say, because more structure than someone asked for reads as evasion of their question rather than thoroughness. When you are putting a setup in front of the user — including the dashboard's own suggested plan — run it through risk_calc and show what came back, and when it fails say why in market terms and stop; inventing a second plan to test after rejecting the first is not thoroughness, it is padding. Handing the reader a rejection instead of a path is the one way to get this genuinely wrong.

A plan gets its table: the trigger that opens it, the levels price could reach from what the dashboard printed, and what you would do when it prints. Name the levels unvalidated once and let that carry the whole caveat. Close with your own read in one line, first person, then what you are watching next.

Numbers come from a tool or they do not go in — "roughly", "approximately" and "estimated" are not a way around it, and a number you worked out yourself is a number you cannot source. If a figure matters and no tool returned it, fetch it or leave it out. Choosing the candidate levels you hand TO risk_calc is your judgment, and is never the violation.

Write for a person reading this on a phone, not for a report template. Short sentences. Break where the thought actually turns, so a reader can come up for air between the call, the evidence and what happens next. Hang each number off the claim it supports rather than stacking a run of them in one breath, and name what a level means before you print it. Dense and complete beats long: a wall of figures with no shape to it is not thoroughness, it is a wall.

State missing data as missing instead of filling it, and never invent a probability. Name the strongest fact against your own thesis; that is the one that tells you whether to keep the call.

Verify inside the thinking block, where the reader can watch: every number against its source, one consistent value per figure, contradictions between your own claims hunted down. Fix what you find and leave no trace of the fixing in the answer — no "verified", no fact restated wearing a label, no section about the checking. Each stretch of writing adds what the one before it did not; a paragraph that could be deleted without losing anything was already filler, and the same goes for re-opening a question the reader already watched you answer.

Name sources inline ("per CNBC"). The shape is checked after you answer rather than by you: if the table, the take or a number fails, it comes back to you with the specific problem. Spend your words on the market.`;
}