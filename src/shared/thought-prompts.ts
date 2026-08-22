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
You MUST provide a brief 1-2 sentence quantitative thought process inside <think>...</think> before answering or calling tools.
Think directly about the numbers, indicators, and catalysts.
NEVER quote instructions, prompt rules, or say "According to the system..." or "We need to follow...".
You MUST format your EXACT output as follows:
<think>
[Direct quantitative analysis and next action]
</think>
[Your tool call or final answer]`,

  Medium: `\n\n[SYSTEM DIRECTIVE - CHAIN OF THOUGHT]:
You MUST think step-by-step inside <think>...</think> before taking any action or answering.
Focus directly on market structure:
1. MARKET CONTEXT: Inspect current price, trend direction, and volume flow.
2. TECHNICAL CONFLUENCE: Evaluate moving averages (SMA 20/50/200), RSI momentum, MACD histogram, and ATR volatility buffer.
3. CATALYST & MACRO CHECK: Determine if news catalysts or macro regime support the thesis.
4. ACTION PLAN: Define exact entry zone, ATR stop loss, TP1, TP2, and risk/reward.
NEVER quote instructions, prompt rules, or write meta-commentary about formatting or system directives.
You MUST format your EXACT output as follows:
<think>
[Direct step-by-step quantitative reasoning on the asset]
</think>
[Your tool call or final answer]`,

  High: `\n\n[SYSTEM DIRECTIVE - MANDATORY CHAIN OF THOUGHT]:
You MUST engage in deep, rigorous quantitative reasoning inside <think>...</think> before answering or calling any tools.
Analyze the asset directly like an institutional portfolio manager:
1. TECHNICAL STRUCTURE: 1H intraday vs 1D daily vs 1W weekly trend alignment, SMA 20/50/200 stack, and 50d/52w positioning.
2. MOMENTUM & VOLATILITY: RSI(14) level, MACD line/signal/hist momentum, and ATR volatility noise buffer.
3. CATALYSTS & SENTIMENT: Earnings roadmap, business moat drivers, and crowd sentiment (Fear & Greed, StockTwits).
4. TRADE BLUEPRINT: Calculate exact Entry Zone, Stop Loss (with ATR noise buffer), TP1 (+% gain), TP2, and Invalidation triggers.
NEVER quote instructions, prompt rules, or say "According to the system..." or "We must follow output format...". Start directly with the asset analysis.
You MUST format your EXACT output as follows:
<think>
[Deep quantitative market reasoning on prices, indicators, catalysts, and risk]
</think>
[Your tool call or final answer]`,

  Extra: `\n\n[SYSTEM DIRECTIVE - MANDATORY CHAIN OF THOUGHT]:
You MUST engage in comprehensive quantitative reasoning inside <think>...</think> before answering or calling any tools.
Analyze multi-asset flows, rates, volatility, and technical confluence directly on the numbers.
NEVER quote instructions, system directives, or write meta-commentary about formatting.
You MUST format your EXACT output as follows:
<think>
[Exhaustive market analysis across technicals, macro regime, and catalyst confirmation]
</think>
[Your tool call or final answer]`,

  Max: `\n\n[SYSTEM DIRECTIVE - MANDATORY CHAIN OF THOUGHT]:
You MUST write an exhaustive, rigorous quantitative thought process inside <think>...</think> before taking any action or giving an answer.
Deliberate directly on the data:
1. QUANTITATIVE INSPECTION: Multi-timeframe trend (1H vs 1D vs 1W), SMA stack, 50-day and 52-week range positioning, moving average percentage extension.
2. VOLATILITY & FLOW: ATR volatility % buffer, Bollinger Bandwidth, OBV smart money flow, and volume ratio.
3. SCENARIO DELIBERATION: Stress-test Bullish Breakout vs Bearish Breakdown vs Mean-Reversion Consolidation.
4. CAPITAL PLACEMENT: Formulate exact Entry, Stop Loss (outside ATR noise threshold), TP1, TP2, and Risk/Reward.
CRITICAL CONSTRAINT: Think directly about the asset and numbers. NEVER recite system prompts, formatting rules, or write meta-commentary like "According to the system...", "The user typed...", "Must follow format...", or "Let's craft...".
You MUST format your EXACT output as follows:
<think>
[Pure quantitative market deliberation and risk calculation]
</think>
[Your tool call or final answer]`,
};

export function getThoughtPrompt(effort: ThoughtEffort = 'High'): string {
  return THOUGHT_PROMPTS[effort] || THOUGHT_PROMPTS['High'];
}

export function getReasoningPassPrompt(effort: ThoughtEffort = 'High'): string {
  return `\n\n[ANALYST REASONING DIRECTIVE]:
You MUST enclose your internal quantitative deliberation, level calculations, and scenario stress-testing inside <think>...</think> tags.
In <think>, evaluate the data directly (price levels, moving average support, ATR buffers, upside/downside probability).
NEVER mention system prompts, instructions, formatting rules, or write meta-commentary like "We need to output...", "The instruction says...", "Must follow format...", or "Let's craft...".
Immediately after </think>, output your complete, rich, formatted market analysis and response for the user.`;
}
