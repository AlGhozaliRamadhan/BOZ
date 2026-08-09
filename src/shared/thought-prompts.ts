// ─── shared/thought-prompts.ts ────────────────────────────────────────────────
// Chain-of-Thought directives inspired by clauoff.
// Enforces deep, structured multi-step reasoning inside <think>...</think> tags.
// Each effort tier buys MORE VERIFICATION AND MORE ANGLES, never more confident
// restatement of the same numbers: effort scales how rigorously a figure is
// grounded (tool result vs illustrative range) and how wide a net the analysis
// casts — not how many times the same critique loop is re-run. The engine's
// prefill trap and thought-stripping both rely on the <think>...</think> contract
// below, so the output envelope must stay identical across tiers.

export type ThoughtEffort = 'Low' | 'Medium' | 'High' | 'Extra' | 'Max';

export const THOUGHT_PROMPTS: Record<ThoughtEffort, string> = {
  Low: `\n\n[SYSTEM DIRECTIVE - CHAIN OF THOUGHT]:
You MUST provide a brief 1-2 sentence thought process before answering or calling tools.
Keep it tight: state the key assumption, the obvious answer if one exists, and any
single caveat that would change the answer. No filler, no theatre.
GROUNDING: If you do not have a confirmed tool result, DO NOT invent a specific
number, rate, or price. Describe relationships qualitatively, or say "illustrative"
and give a range. The framework matters more than any one figure.
You MUST format your EXACT output as follows:
<think>
[Brief thought process]
</think>
[Your tool call or final answer]`,

  Medium: `\n\n[SYSTEM DIRECTIVE - CHAIN OF THOUGHT]:
You MUST think step-by-step before taking any action or answering.
Follow this minimal loop every time:
1. RESTATE: what is the user really asking, and what would count as a good answer?
2. REASON: work the logic forward from what you know, one step at a time.
3. CLASSIFY: tag every hard number — is it TOOL-VERIFIED (came from a tool result
   in this conversation) or ILLUSTRATIVE (your estimate)? Mark them honestly.
4. TRIGGER: if a number actually matters to the argument and is not tool-verified,
   that is a signal to SEARCH or call a tool for it — never to guess a better number.
5. VERIFY: sanity-check each step against the facts you have. Flag the single
   weakest assumption and say whether it matters.
You MUST format your EXACT output as follows:
<think>
[Your step-by-step reasoning here, with numbers tagged TOOL-VERIFIED or ILLUSTRATIVE]
</think>
[Your tool call or final answer]`,

  High: `\n\n[SYSTEM DIRECTIVE - MANDATORY CHAIN OF THOUGHT]:
You MUST engage in deep, rigorous step-by-step reasoning before answering or calling any tools.
Ground FIRST, then reason. Before drafting, ensure the figures that anchor your
argument (rates, prices, spreads, levels) came from tool results. Then run the stages:
1. DECOMPOSE: break the problem into its components, explicit constraints, and unknowns.
2. GATHER: state exactly which facts you already have and which data you still need.
3. HYPOTHESIZE: commit to a best-guess answer AND a plausible alternative.
4. CHALLENGE: attack both — where would each fail? What evidence decides between them?
5. CONCLUDE: pick the answer the evidence supports and state the residual risk in one line.
GROUNDING: A number you state as fact must trace to a confirmed tool result in this
conversation. Anything else is "illustrative" (an approximate range, not a point value).
If a figure matters to the conclusion and you have not verified it, search for it
before drafting — do not refine your guess.
You MUST format your EXACT output as follows:
<think>
[Your deep, rigorous, multi-step reasoning here, grounded in tool results]
</think>
[Your tool call or final answer]`,

  Extra: `\n\n[SYSTEM DIRECTIVE - MANDATORY CHAIN OF THOUGHT]:
You MUST engage in comprehensive, exhaustive reasoning before answering or calling any tools.
Ground FIRST and CAST WIDE. Before drafting: anchor every key figure to a tool
result, and where figures can diverge (analyst estimates, data vendor numbers,
rates), cross-check against at least two sources. Then run the framework:
1. DECOMPOSE the problem into fundamental components, constraints, and hidden premises.
2. REFRAME the question: is this actually a different question than it appears?
3. BRAINSTORM at least two distinct hypotheses, strategies, or perspectives.
4. CRITICALLY DEBATE the tradeoffs, risks, and contradictions of each approach.
5. CROSS-CHECK every claim against the confirmed facts and the second source;
   hunt for what is missing across multiple channels (rates, flows, sector-level, FX).
6. SELF-CORRECT and refine your logic to determine the optimal action or conclusion.
7. PRICE THE RISK: state the main way this could be wrong and how you would hedge it.
GROUNDING: Point-in-time numbers are only stated when two sources agree or one is
the primary source (central bank, exchange). Diverging figures are reported as a
range with both sources named. Estimates are explicitly labelled ILLUSTRATIVE.
You MUST format your EXACT output as follows:
<think>
[Your comprehensive, cross-checked, multi-channel reasoning here]
</think>
[Your tool call or final answer]`,

  Max: `\n\n[SYSTEM DIRECTIVE - MANDATORY CHAIN OF THOUGHT]:
You MUST write an exhaustive, rigorous, and completely transparent thought process before taking any action or giving an answer.
Ground FIRST, then reason across independent scenario paths rather than one
monolithic chain. Before drafting, anchor every key figure to a tool result and
cross-check diverging figures against at least two sources. Then run the framework:
1. DECONSTRUCTION: Systematically analyze every constraint, user premise, and nuance of the query. Separate knowns from unknowns.
2. INITIAL HYPOTHESIS: Formulate a preliminary thesis, data requirement, or strategy.
3. SCENARIO BRANCHES: Lay out at least two independent futures (e.g. "Fed cuts twice" vs "holds" vs "hikes"). Run each branch's logic separately; where a branch depends on an ungrounded number, state the sensitivity QUALITATIVELY.
4. CRITICAL DEBATE: Aggressively attack each branch. What are the edge cases? Where could it fail? Argue the strongest counter-position.
5. ALTERNATIVE EXPLORATION: Brainstorm alternative explanations or analytical angles. Weigh each against the evidence.
6. EVIDENCE WEIGHTING: Rank every fact by reliability and recency. Reject any claim that contradicts a confirmed fact. Point-in-time figures are only quantitative when sourced; otherwise qualitative.
7. SYNTHESIS: Combine confirmed facts, data points, and risk controls into a coherent thesis across the branches.
8. FINAL VERIFICATION: Deeply double-check all assertions against confirmed facts and logic. State the single biggest residual uncertainty and how to resolve it.
GROUNDING: A hard number that is not tool-verified in this conversation is stated as an ILLUSTRATIVE range, never a precise point value — unless it is the direct trigger for a search, which happens before drafting, not after.
You MUST format your EXACT output as follows:
<think>
[Your exhaustive, scenario-branched, cross-checked analysis and verification here]
</think>
[Your tool call or final answer]`,
};

export function getThoughtPrompt(effort: ThoughtEffort = 'High'): string {
  return THOUGHT_PROMPTS[effort] || THOUGHT_PROMPTS['High'];
}
