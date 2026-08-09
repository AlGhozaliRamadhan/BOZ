// ─── agents/chat.agent.ts ─────────────────────────────────────────────────────
// BOZ Interactive Chat Agent
//
// Features:
//  • Agent-in-agent: a ReasoningAgent sub-process refines the final analysis
//    using a scratchpad of confirmed facts gathered during tool calls.
//  • Per-step thought display: after each tool result, the AI emits a short
//    "what I just learned / what I'll do next" thought that prints inline.
//  • Persistent evidence ledger: facts written to the ledger are immutable —
//    the final analysis MUST reference them and cannot contradict them.
//  • Smart web search: DDG HTML → DDG JSON → Yahoo Finance → Indonesian RSS.
//  • Indonesian news sources wired into fetch_news tool.
//  • scan_indonesia_momentum: IDX scanner that hunts hidden movers by
//    quote-screening the full universe before chart-scanning candidates.

import { BaseAgent, ParsedToolCall, AgentMessage } from './base.agent.js';
import { askQuestion, restoreRawMode } from '../cli/cli.js';
import { newsFetchService } from '../services/news/news.fetch.service.js';
import { yahooFinance } from '../services/market/yahoo.service.js';
import { idxScannerService } from '../services/market/idx.scanner.service.js';
import { SentimentService } from '../services/market/sentiment.service.js';
import { webSearchService } from '../services/search/web.search.service.js';
import { resolveSymbol, resolveSymbolIDX } from '../shared/market-constants.js';
import { memoryService } from '../services/memory.service.js';
import { withRetry } from '../utils/retry.util.js';
import { getThoughtPrompt } from '../shared/thought-prompts.js';
// ─── Evidence ledger entry ────────────────────────────────────────────────────
// Once a fact is added to the ledger it cannot be contradicted.
// The reasoning agent receives all ledger entries and must cite them.

interface LedgerEntry {
  step:    number;
  tool:    string;
  fact:    string;   // concise factual statement, e.g. "IHSG price: 6162 (+1.1%)"
  quality: 'confirmed' | 'partial' | 'empty';
}

// ─── InteractiveChatAgent ─────────────────────────────────────────────────────

export class InteractiveChatAgent extends BaseAgent {
  private sentimentService = new SentimentService();
  // ─── Session-level data cache ─────────────────────────────────────────────
  // Stores confirmed facts from tool calls across turns so the AI can answer
  // follow-up questions WITHOUT re-running expensive tool calls.
  private sessionCache: Map<string, string> = new Map();

  constructor() { super(); }

  // ─── ANSI palette ──────────────────────────────────────────────────────────

  private readonly V = {
    reset:   '\x1b[0m',
    dim:     '\x1b[2m',
    bold:    '\x1b[1m',
    ghost:   '\x1b[90m',
    white:   '\x1b[97m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    cyan:    '\x1b[36m',
    magenta: '\x1b[35m',
    g:  (s: string) => '\x1b[32m' + s + '\x1b[0m',
    r:  (s: string) => '\x1b[31m' + s + '\x1b[0m',
    c:  (s: string) => '\x1b[36m' + s + '\x1b[0m',
    m:  (s: string) => '\x1b[35m' + s + '\x1b[0m',
    d:  (s: string) => '\x1b[2m'  + s + '\x1b[0m',
    w:  (s: string) => '\x1b[97m' + s + '\x1b[0m',
    gh: (s: string) => '\x1b[90m' + s + '\x1b[0m',
    y:  (s: string) => '\x1b[33m' + s + '\x1b[0m',
    b:  (s: string) => '\x1b[1m'  + s + '\x1b[0m',
  } as const;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private fmtElapsed(ms: number): string {
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    return Math.floor(s / 60) + 'm' + String(Math.floor(s % 60)).padStart(2, '0') + 's';
  }

  // ─── Console rendering ─────────────────────────────────────────────────────

  private printActionBlock(step: number, toolName: string, args: Record<string, any>, elapsed: string, success: boolean): void {
    const V = this.V;
    const argStr = Object.values(args).map(v => String(v)).join(' \u00b7 ');
    const label  = argStr
      ? toolName + '  ' + V.d('\u00b7') + '  ' + V.gh(argStr.slice(0, 60))
      : toolName;
    // Solid circle: \u25cf (●) colored green or red via ANSI instead of emoji
    const statusIcon = success ? V.g('\u25cf') : V.r('\u25cf');
    console.log('  ' + V.d('\u251c\u2500') + ' ' + V.c('[step ' + step + ']') + ' ' + statusIcon + '  ' + V.w(label) + '  ' + V.d(elapsed));
  }

  private printThoughtBubble(thought: string): void {
    // Prints a dim inline thought after each observation — shows live reasoning
    const V = this.V;
    const W = 70;
    const prefix  = '  \u2502  \u25b8 ';
    const indent  = '  \u2502    ';
    const words   = thought.trim().split(/\s+/);
    let   line    = '';
    let   first   = true;
    for (const word of words) {
      const cand = line ? line + ' ' + word : word;
      if (cand.length > W) {
        console.log((first ? prefix : indent) + V.d(V.y(line)));
        line = word; first = false;
      } else { line = cand; }
    }
    if (line) console.log((first ? prefix : indent) + V.d(V.y(line)));
  }

  private printObservationBlock(toolName: string, obs: string): void {
    const V     = this.V;
    const lines = this.formatObservation(toolName, obs);
    if (!lines.length) { console.log('  ' + V.d('\u2502') + '  ' + V.gh('(no data)')); return; }
    for (const ln of lines) console.log('  ' + V.d('\u2502') + '  ' + ln);
  }

  private printSpinner(step: number | null, msg: string): () => void {
    const FRAMES = ['\u280b','\u2819','\u2839','\u2838','\u283c','\u2834','\u2826','\u2827','\u2807','\u280f'];
    const V      = this.V;
    let   i      = 0;
    const isTTY  = process.stdout.isTTY ?? true;
    const prefix = step !== null
      ? '  ' + V.d('\u251c\u2500') + ' ' + V.c('[step ' + step + ']')
      : '  ' + V.d('\u2502');
      
    if (!isTTY) { 
      process.stdout.write(prefix + '  ' + V.gh(msg) + '\n');
      return () => {}; 
    }
    process.stdout.write(prefix + '  ' + V.gh(msg) + '  ' + V.d(FRAMES[0]));
    const tid = setInterval(() => {
      i = (i + 1) % FRAMES.length;
      process.stdout.write('\r\x1b[K' + prefix + '  ' + V.gh(msg) + '  ' + V.d(FRAMES[i]));
    }, 80);
    return () => { clearInterval(tid); process.stdout.write('\r\x1b[K'); };
  }

  // ─── Observation formatter ─────────────────────────────────────────────────

  private formatObservation(toolName: string, raw: string): string[] {
    const V = this.V;
    const lines: string[] = [];

    if (toolName === 'fetch_price') {
      const pm = raw.match(/Price:\s*([\d,.]+)/);
      const cm = raw.match(/Change:\s*([-\d.]+)%/);
      const nm = raw.match(/Name:\s*([^|]+)/);
      const sm = raw.match(/Symbol:\s*([^|]+)/);
      const price = pm?.[1] ?? '\u2014';
      const name  = nm?.[1]?.trim() ?? sm?.[1]?.trim() ?? '';
      const chg = cm ? parseFloat(cm[1]) : 0;
      const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
      const chgCol = chg > 0 ? V.g(chgStr) : chg < 0 ? V.r(chgStr) : V.d(chgStr);
      lines.push(V.gh('price   ') + V.w('$' + price) + '  ' + chgCol + (name ? '  ' + V.d(name) : ''));
    } else if (toolName === 'fetch_news') {
      const items = raw.split('\n').filter(l => l.trim().startsWith('-'));
      for (const item of items.slice(0, 5)) {
        const clean = item.replace(/^-\s*/, '').trim();
        lines.push(V.d('\u00b7') + ' ' + V.gh(clean.length > 72 ? clean.slice(0, 69) + '\u2026' : clean));
      }
      if (!items.length) {
        const firstLines = raw.split('\n').filter(l => l.trim()).slice(0, 2);
        for (const l of firstLines) lines.push(V.gh(l.slice(0, 80)));
        if (!firstLines.length) lines.push(V.gh('No headlines found.'));
      }
    } else if (toolName === 'web_search') {
      const items = raw.split('\n').filter(l => /^[-•\d]/.test(l.trim()));
      const display = items.length ? items : raw.split('\n').filter(l => l.trim());
      for (const item of display.slice(0, 5)) {
        const clean = item.replace(/^[-•*\d.]\s*/, '').trim();
        lines.push(V.d('\u00b7') + ' ' + V.gh(clean.length > 72 ? clean.slice(0, 69) + '\u2026' : clean));
      }
      if (!display.length) lines.push(V.gh('No results.'));
    } else if (toolName === 'fetch_sentiment') {
      try {
        const json = JSON.parse(raw);
        const fg  = json.fear_greed;
        const sig = (json.overall_signals ?? []).join('  ');
        const st  = json.reddit_buzz?.stocktwits;
        if (fg) {
          const fgVal = fg.value ?? '?';
          const fgLabel = fg.classification ?? fg.label ?? '';
          const fgCol = Number(fgVal) >= 70 ? V.r : Number(fgVal) >= 50 ? V.y : V.c;
          lines.push(V.gh('fear/greed  ') + fgCol(String(fgVal)) + '  ' + V.d(fgLabel));
        }
        if (st) {
          const bp    = st.bull_ratio != null ? st.bull_ratio.toFixed(0) : (st.bullish_percent ?? '?');
          const bulls = st.bullish ?? '?';
          const bears = st.bearish ?? '?';
          const tot   = st.total_with_sentiment ?? st.total ?? '?';
          lines.push(V.gh('stocktwits  ') + V.g(bp + '% bullish') + '  ' + V.d(`bulls ${bulls} \u00b7 bears ${bears} \u00b7 total ${tot}`));
        }
        if (sig) lines.push(V.gh('signals     ') + V.c(sig));
      } catch { lines.push(V.gh(raw.slice(0, 90))); }
    } else if (toolName === 'summon_agent') {
      const clean = this.stripToolCallMarkup(this.stripThinkingBlock(raw));
      const reportLines = clean.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of reportLines.slice(0, 14)) {
        const display = l.length > 86 ? l.slice(0, 83) + '...' : l;
        lines.push(V.c('| ') + V.gh(this.stripInlineMarkdown(display)));
      }
      if (reportLines.length > 14) lines.push(V.d(`| ... ${reportLines.length - 14} more lines`));
      if (!reportLines.length) lines.push(V.gh('Sub-agent returned no usable report.'));
    } else {
      lines.push(V.gh(raw.slice(0, 90)));
    }

    return lines;
  }

  // ─── Response printer ──────────────────────────────────────────────────────

  private stripInlineMarkdown(text: string): string {
    return text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1');
  }

  private stripToolCallMarkup(text: string): string {
    return (text ?? '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .replace(/<function=[\s\S]*?<\/function>/gi, '')
      .replace(/<parameter=[\s\S]*?<\/parameter>/gi, '')
      .replace(/<\/?(?:tool_call|function|parameter)[^>]*>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private stripThinkingBlock(text: string): string {
    return (text ?? '')
      .replace(/<thinking>[\s\S]*?<\/thinking>\n*/gi, '')
      .trim();
  }

  private formatInlineMarkdown(text: string): string {
    const V = this.V;
    return text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/`([^`]+)`/g, (_, s) => V.c(String(s)))
      .replace(/\*\*([^*]+)\*\*/g, (_, s) => V.b(V.w(String(s))))
      .replace(/__([^_]+)__/g, (_, s) => V.b(V.w(String(s))))
      .replace(/~~([^~]+)~~/g, (_, s) => V.d(String(s)))
      .replace(/\*([^*]+)\*/g, (_, s) => V.gh(String(s)))
      .replace(/_([^_]+)_/g, (_, s) => V.gh(String(s)));
  }

  private isMarkdownTableSeparator(line: string): boolean {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
  }

  private formatMarkdownTable(rows: string[]): string[] {
    const parsed = rows
      .map(r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => this.stripInlineMarkdown(c.trim())))
      .filter(c => c.length > 0);
    if (parsed.length < 2) return rows.map(r => this.stripInlineMarkdown(r));
    const header = parsed[0];
    const body = parsed.slice(2).length ? parsed.slice(2) : parsed.slice(1);
    const cols = Math.max(...parsed.map(c => c.length));
    const widths = new Array(cols).fill(0).map((_, col) => Math.max(...parsed.map(c => (c[col] ?? '').length), 0));
    const padRow = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ');
    const sep = widths.map(w => '-'.repeat(Math.max(w, 3))).join('  ');
    return [padRow(header), sep, ...body.map(padRow)];
  }

  private printResponse(text: string): void {
    const V = this.V;
    const W = 76;
    
    // Extract and format <thinking> blocks first
    const thinkingMatch = (text ?? '').match(/<thinking>([\s\S]*?)<\/thinking>/i);
    let mainText = (text ?? '').replace(/<thinking>[\s\S]*?<\/thinking>\n*/gi, '').trim();

    if (thinkingMatch) {
      console.log('  ' + V.d('╭── [thinking] ' + '─'.repeat(W - 17)));
      const tLines = thinkingMatch[1].trim().split('\n');
      for (const l of tLines) {
        console.log('  ' + V.d('│ ') + V.d(l.trim()));
      }
      console.log('  ' + V.d('╰' + '─'.repeat(W - 3)));
      console.log('');
    }

    const blocks = mainText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trimEnd());
      const isTable = lines.length >= 2 && lines[0].includes('|') && this.isMarkdownTableSeparator(lines[1]);
      if (isTable) {
        const tl = this.formatMarkdownTable(lines.slice(0, Math.min(lines.length, 12)));
        for (const l of tl) console.log('  ' + V.d(l));
        console.log('');
        continue;
      }
      let inCodeBlock = false;
      for (const rawLine of lines) {
        const trimmedRaw = rawLine.trim();
        if (/^```/.test(trimmedRaw)) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (inCodeBlock) {
          console.log('    ' + V.d(rawLine));
          continue;
        }

        const heading = trimmedRaw.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const label = this.stripInlineMarkdown(heading[2]).trim();
          if (label) console.log('\n  ' + V.b(V.w(label)));
          continue;
        }

        const t = this.stripInlineMarkdown(rawLine).replace(/^>\s*/, '').trim();
        if (!t) { console.log(''); continue; }
        if (/^[A-Z][A-Z\s\(\)\-:&\/]{4,}$/.test(t)) { console.log('\n  ' + V.b(V.w(t))); continue; }
        if (/^[-•*]\s/.test(t) || /^\d+\.\s/.test(t)) {
          const m = t.match(/^([-•*]|\d+\.)\s/);
          const pfx = m ? m[0] : '- ';
          const content = this.formatInlineMarkdown(trimmedRaw.replace(/^([-â€¢*]|\d+\.)\s/, ''));
          const words = content.split(/\s+/);
          let line = ''; let first = true;
          for (const word of words) {
            const cand = line ? line + ' ' + word : word;
            if (cand.length > W - pfx.length - 4) {
              console.log((first ? '  ' + V.d(pfx) : '  ' + ' '.repeat(pfx.length + 1)) + line);
              line = word; first = false;
            } else { line = cand; }
          }
          if (line) console.log((first ? '  ' + V.d(pfx) : '  ' + ' '.repeat(pfx.length + 1)) + line);
          continue;
        }
        const words = this.formatInlineMarkdown(trimmedRaw.replace(/^>\s*/, '')).split(/\s+/);
        let line = '';
        for (const word of words) {
          const cand = line ? line + ' ' + word : word;
          if (cand.length > W) { console.log('  ' + line); line = word; }
          else line = cand;
        }
        if (line) console.log('  ' + line);
      }
      console.log('');
    }
  }

  // ─── Tool spinner label ────────────────────────────────────────────────────

  private toolFetchLabel(toolName: string, args: Record<string, any>): string {
    switch (toolName) {
      case 'fetch_price':              return 'fetching price · ' + (resolveSymbolIDX(args.symbol_or_name as string) || String(args.symbol_or_name ?? '').toUpperCase());
      case 'fetch_news':               return 'fetching news · ' + String(args.query ?? '').slice(0, 45);
      case 'fetch_sentiment':          return 'fetching crowd sentiment';
      case 'web_search':               return 'searching web · ' + String(args.query ?? '').slice(0, 45);
      case 'scan_indonesia_momentum':  return 'scanning IDX · ' + String(args.sector ?? 'all sectors') + ' · ' + String(args.scan_mode ?? 'fast');
      default:                         return 'running ' + toolName;
    }
  }

  // ─── System prompt ─────────────────────────────────────────────────────────

  protected buildSystemPrompt(): string {
    const memory = memoryService.getMemory();
    const prefs = memory.preferences.length ? `\nUSER PREFERENCES:\n${memory.preferences.map(p => '  - ' + p).join('\n')}` : '';
    const facts = memory.facts.length ? `\nUSER FACTS:\n${memory.facts.map(f => '  - ' + f).join('\n')}` : '';

    // Build session cache block — injected into system prompt so AI knows
    // what data was already fetched this session and can skip re-fetching.
    const cacheEntries = Array.from(this.sessionCache.entries());
    const cacheBlock = cacheEntries.length > 0
      ? `\nSESSION DATA CACHE (already fetched this session — DO NOT re-fetch these unless user explicitly asks for a refresh):\n${cacheEntries.map(([k, v]) => `  [${k}] ${v}`).join('\n')}`
      : '';

    const thoughtDirective = getThoughtPrompt('Max');

    return [
      'You are BOZ, an elite AI market assistant and quantitative analyst. You are also a conversational AI.',
      'You think like a hedge fund analyst — skeptical, data-driven, always asking "is this enough?"',
      prefs,
      facts,
      cacheBlock,
      thoughtDirective,
      '',
      'CONVERSATIONAL AI RULES:',
      '  - SESSION CACHE: Before calling ANY tool, check the SESSION DATA CACHE above.',
      '    If the data you need (price, sentiment, scan results, news) is already there, USE IT directly.',
      '    Do NOT re-fetch data that is already in the cache just because the user asked a follow-up.',
      '    Example: user asked "which stock should I buy?" → you scanned IDX → cache has scan results.',
      '    Next question "when should I buy?" → answer from cache, NO new tool calls needed.',
      '    Only re-fetch if the user explicitly says "refresh", "update", or "check again".',
      '  ─────────────────────────────────────────────────────────────────────',
      '',
      '  - You have FULL AUTONOMY to decide whether you need to use tools or not. Use your intelligence to read the user\'s implicit needs.',
      '  - If they are just greeting you, asking a generic question, or asking a follow-up that can be answered using the recent conversation history OR the SESSION DATA CACHE above, DO NOT call tools. Just answer them naturally.',
      '  - If you genuinely need live data, news, or a fresh scan to answer their question accurately AND it is not already in the SESSION DATA CACHE, then call the tools.',
      '  - Do not be rigidly linear. Be an intelligent, context-aware conversational partner.',
      '  - ANTI-LOOP RULE: If you just ran tools 1 turn ago and the user asks a follow-up about the SAME topic,',
      '    it is almost always WRONG to call tools again. Answer from memory and cache instead.',
      '  - COST AWARENESS: Every tool call takes 10-30 seconds. Be frugal. Use the cache.',

      '',
      'TOOLS:',
      '  fetch_price(symbol_or_name)       — live price for any asset',
      '  fetch_news(query, category?)      — market news; query is a free-text search string',
      '  fetch_sentiment()                 — Fear & Greed + StockTwits crowd data',
      '  web_search(query)                 — live web search; use when other tools give nothing useful',
      '  scan_indonesia_momentum(sector?,  — IDX scanner; default fast mode quote-screens',
      '    signal_type?, setup?, scan_mode?) the full universe, then chart-scans candidates.',
      '                                      Deep mode is exhaustive. Scores price momentum,',
      '                                      volume surge, and 52-week range position.',
      '                                      NOT just blue chips. Use whenever asked about',
      '                                      Indonesian stocks to buy/watch, sector rotation,',
      '                                      or which IDX stocks have momentum building.',
      '  update_memory(fact, is_preference)— save long-term user facts or preferences',
      '',
      'THINKING RULES — CRITICAL:',
      '  1. After EVERY tool result, write a short thought (1-3 sentences) tagged [THOUGHT]:',
      '     - What did I just learn from this result?',
      '     - Is this data good enough, or do I need more?',
      '     - What is my next move and why?',
      '  2. If a tool returns empty, irrelevant, or generic results: SAY SO in your thought,',
      '     then immediately call web_search with a better query. Do not accept empty results.',
      '  3. Build a picture iteratively. Each tool call should add NEW information.',
      '     If two consecutive calls give the same type of empty result, pivot to a different angle.',
      '  4. You may call 6-10 tools per query if needed. More data = better analysis.',
      '  4b. BUT: if data is already in the SESSION CACHE, skip the tool call. Cache = free. Tool = 30s wait.',
      '  5. Maintain a global market focus. Do not restrict analysis solely to a specific region unless requested.',
      '  6. FOLLOW-UP QUESTIONS: If the user asks a follow-up question about the analysis you JUST provided (e.g., "so which one should I buy?"), DO NOT call tools again. Answer directly using the recent conversation context.',
      '',
      'INDONESIAN STOCK HUNTING RULES:',
      '  - When asked for a NEW scan of IDX stocks to buy/invest/watch: ALWAYS call scan_indonesia_momentum first.',
      '  - Do NOT call the scan if the user is just asking a follow-up question about a scan you already ran in the previous message.',
      '    Autonomously decide which setup filter to use (e.g., "rebound", "breakout", "oversold") based on market context or the user\'s implicit tone. Do not just default to "momentum".',
      '    It does the real research: quote-screening the IDX universe and scoring candidates quantitatively.',
      '    Do NOT just name BBCA/BBRI/TLKM from memory — those are lazy defaults.',
      '  - After the scan, call fetch_price on the top 2-3 BUY candidates to confirm live prices.',
      '  - Then call fetch_news WITH THE SPECIFIC COMPANY NAME AND SYMBOL to check for specific catalysts, earnings quality, or red flags (e.g. "GGRP Gunung Raja Paksi news"). Avoid generic macro news.',
      '  - If news is irrelevant, call web_search to find deep fundamentals (valuation, competitive position, profitability).',
      '  - Only after those steps can you give a confident recommendation.',
      '  - Be specific: cite the score, fundamental reality, volume ratio, and 52w range position.',
      '',
      'SUB-AGENT DELEGATION (OPUS-STYLE AUTONOMY):',
      '  - You have a team of highly specialized sub-agents: QuantBrain, NewsHound, RiskManager, and DataGoblin.',
      '  - You MUST heavily rely on them. If you are doing ANYTHING beyond a trivial price check, you SHOULD ALWAYS summon at least one sub-agent to do the heavy lifting.',
      '  - If a user asks for a deep dive, a complex market analysis, a stock recommendation, or a momentum scan, it is MANDATORY to summon 2-3 agents CONCURRENTLY to analyze different angles (e.g., QuantBrain for technicals, RiskManager for flaws, NewsHound for catalysts).',
      '  - Do not try to analyze complex stocks by yourself. Delegate the deep-thinking to your sub-agents, wait for their reports, and then synthesize their findings into a final, elite-level conclusion.',
      '',
      'EVIDENCE RULES — IMMUTABLE:',
      '  - Facts confirmed from tool results are locked. You cannot contradict them in analysis.',
      '  - If price data says +1.1%, your analysis must reflect that. Never say "price is unclear"',
      '    after a successful fetch_price call.',
      '  - If news returned nothing, say exactly that in analysis. Do not invent headlines.',
      '',
      'CONTRARIAN ANALYSIS:',
      '  - StockTwits >70% bullish = caution (retail euphoria precedes reversals)',
      '  - StockTwits <30% bullish = buy signal (panic = opportunity)',
      '  - Fear & Greed >75 = reduce long confidence',
      '  - Fear & Greed <25 = strong buy signal',
      '',
      'OUTPUT FORMAT:',
      '  - Reply in a natural, conversational AI text message style. Avoid all-caps shouting.',
      '  - Focus on what the user needs: practical insights, global market impacts, and clear actionability.',
      '  - For Indonesian stocks: rank your picks, give entry zone, stop-loss, and why this stock',
      '    specifically showed up in the scan (not just generic fundamentals).',
      '  - NEVER use markdown tables. If you have data to present, use a bulleted list instead. Tables break terminal wrapping.',
      '  - Never pad with filler. Be sharp and direct.',
    ].join('\n');
  }

  protected buildInitialPrompt(): string { return ''; }

  protected getToolDefinitions(): object[] {
    return [
      {
        type: 'function',
        function: {
          name: 'update_memory',
          description: 'Save a persistent fact or preference about the user across sessions. Use this when the user mentions their trading style, portfolio, or rules.',
          parameters: {
            type: 'object',
            properties: {
              fact: { type: 'string', description: 'The fact or preference to save.' },
              is_preference: { type: 'boolean', description: 'True if it is a rule/preference, false if it is a general fact.' },
            },
            required: ['fact', 'is_preference'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'summon_agent',
          description: 'Summon a specialized sub-agent to perform complex analysis or deep thinking while you wait. Use this to delegate heavy reasoning tasks.',
          parameters: {
            type: 'object',
            properties: {
              agent_name: { type: 'string', enum: ['NewsHound', 'DataGoblin', 'QuantBrain', 'RiskManager'], description: 'Which agent to summon.' },
              task: { type: 'string', description: 'The specific task, including any data you want them to analyze.' },
            },
            required: ['agent_name', 'task'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_price',
          description: 'Fetch live market price for any asset — stocks, indices, crypto, forex, commodities.',
          parameters: {
            type: 'object',
            properties: {
              symbol_or_name: { type: 'string', description: 'Ticker or name. E.g.: BTC, AAPL, IHSG, BBCA, GOLD, EURUSD' },
            },
            required: ['symbol_or_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_news',
          description: [
            'Fetch recent market news using a free-text search query.',
            'Checks Indonesian RSS feeds (CNBC Indonesia, Bisnis.com, Kontan, Detik Finance, IDX Channel)',
            'as well as global sources.',
            'If this returns empty or irrelevant results, follow up with web_search.',
            'Examples: "IHSG Indonesia bursa saham hari ini" | "Bitcoin BTC news today" | "BBCA earnings"',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              query:    { type: 'string', description: 'Free-text search. Be specific and use local language terms for Indonesian assets.' },
              category: { type: 'string', enum: ['crypto', 'stocks', 'macro', 'broad', 'indonesia'], description: 'Optional category hint.' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_sentiment',
          description: 'Fetch global crowd sentiment — CNN Fear & Greed index + StockTwits crowd ratio. Always use for buy/sell/hold recommendations.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: [
            'Search the live web for current information.',
            'Use this whenever other tools return empty, generic, or insufficient results.',
            'Especially useful for: Indonesian market news, sector analysis, macro events, company news.',
            'Try multiple queries if the first search is empty.',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Specific search query. E.g.: "IHSG outlook 2025 Indonesia stock market today"' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'scan_indonesia_momentum',
          description: [
            'Scan the IDX (Indonesia Stock Exchange) universe for hidden momentum setups.',
            'Default fast mode quote-screens the full IDX universe first, then chart-scans the strongest candidates.',
            'Deep mode chart-scans every valid IDX quote when the user explicitly asks for exhaustive coverage.',
            'Does NOT just return blue chips; it screens across IDX sectors and scores candidates',
            'on: price momentum (1d/5d/20d), volume surge vs average, distance from 52-week high/low,',
            'and RSI-proxy signal. Returns ranked BUY candidates and WATCH list sorted by score.',
            'Use this when the user asks about Indonesian stocks to buy, sector rotation, undervalued movers,',
            'or wants to find which stocks are quietly gaining momentum on IDX.',
            'Optional: filter by sector (banking, consumer, mining, energy, tech, property, telecom, healthcare, all).',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              sector: {
                type: 'string',
                enum: ['all', 'banking', 'consumer', 'mining', 'energy', 'tech', 'property', 'telecom', 'healthcare', 'industrial'],
                description: 'Filter by sector or "all" to scan everything.',
              },
              signal_type: {
                type: 'string',
                enum: ['buy', 'sell', 'any'],
                description: '"buy" to find stocks with positive momentum building, "sell" for deteriorating, "any" for all signals.',
              },
              setup: {
                type: 'string',
                enum: ['momentum', 'rebound', 'all_time_low', 'downtrend', 'breakout', 'oversold'],
                description: 'Filter by setup type. "momentum" (default) for trending stocks, "rebound" for bouncing from lows, "all_time_low" for stocks at bottom, "downtrend" for falling stocks, "breakout" for stocks pushing 52w highs with volume, "oversold" for stocks that crashed >15% in 20 days. IMPORTANT: Autonomously select the BEST setup based on user sentiment or broad market context. If the market is crashing, scan for "rebound" or "oversold". If user wants high growth, scan for "breakout". Do not always default to "momentum".',
              },
              scan_mode: {
                type: 'string',
                enum: ['fast', 'deep'],
                description: '"fast" (default) quote-screens all IDX stocks then chart-scans top candidates. "deep" chart-scans every valid IDX quote; use only when exhaustive coverage is requested.',
              },
            },
            required: [],
          },
        },
      },
    ];
  }

  // ─── Tool executor ─────────────────────────────────────────────────────────

  protected async executeTool(call: ParsedToolCall, state?: any): Promise<string> {
    try {
      switch (call.name) {
        
        case 'summon_agent': {
          const agent_name = (call.arguments.agent_name as string) ?? 'UnknownAgent';
          const task = (call.arguments.task as string) ?? '';
          return await this.simulateSubAgent(agent_name, task, state?.messages, state?.ledger);
        }

        case 'fetch_price': {
          const raw    = call.arguments.symbol_or_name as string;
          const symbol = resolveSymbolIDX(raw) || raw.toUpperCase();
          const quote  = await withRetry(() => yahooFinance.quote(symbol), 3, 2000);
          const price  = (quote as any).regularMarketPrice;
          const change = (quote as any).regularMarketChangePercent;
          if (price === undefined || price === null)
            return `No price data for ${symbol}. Yahoo Finance may not support this symbol or market is closed.`;
          const chgNum = typeof change === 'number' ? change : 0;
          const name   = (quote as any).shortName || (quote as any).longName || symbol;
          const dayHigh  = (quote as any).regularMarketDayHigh;
          const dayLow   = (quote as any).regularMarketDayLow;
          const prevClose = (quote as any).regularMarketPreviousClose;
          return [
            `Symbol: ${symbol} | Name: ${name} | Price: ${price} (Change: ${chgNum.toFixed(2)}%)`,
            dayHigh  != null ? `Day Range: ${dayLow} – ${dayHigh}` : '',
            prevClose != null ? `Prev Close: ${prevClose}` : '',
          ].filter(Boolean).join(' | ');
        }

        case 'update_memory': {
          const fact = (call.arguments.fact as string) ?? '';
          const isPref = (call.arguments.is_preference as boolean) ?? false;
          if (isPref) {
            memoryService.addPreference(fact);
          } else {
            memoryService.addFact(fact);
          }
          return `Successfully saved memory: ${fact}`;
        }

        case 'fetch_news': {
          const query    = (call.arguments.query as string) ?? '';
          const category = (call.arguments.category as string) ?? 'broad';
          const items: string[] = [];

          // Fetch from all relevant sources in parallel
          const fetchers: Promise<any[]>[] = [];

          if (category === 'indonesia' || category === 'stocks' || category === 'broad') {
            fetchers.push(newsFetchService.fetchIndonesiaNews().catch(() => []));
          }
          if (category === 'crypto') {
            fetchers.push(newsFetchService.fetchCryptoNews().catch(() => []));
          }
          if (category === 'stocks' || category === 'broad') {
            fetchers.push(newsFetchService.fetchStockNews().catch(() => []));
            fetchers.push(newsFetchService.fetchBroadMarketNews().catch(() => []));
          }
          if (category === 'macro') {
            fetchers.push(newsFetchService.fetchMacroNews().catch(() => []));
            fetchers.push(newsFetchService.fetchBroadMarketNews().catch(() => []));
          }
          if (fetchers.length === 0) {
            fetchers.push(newsFetchService.fetchBroadMarketNews().catch(() => []));
            fetchers.push(newsFetchService.fetchIndonesiaNews().catch(() => []));
          }

          const settled = await Promise.all(fetchers);
          const fetched: any[] = settled.flat();

          // Relevance scoring against query
          const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
          const scored = fetched
            .map(n => {
              const title = (n.title ?? '').toLowerCase();
              const blob = `${title} ${n.details ?? ''} ${(n.assets ?? []).join(' ')} ${n.source ?? ''}`.toLowerCase();
              let score = 0;
              for (const w of queryWords) {
                if (title.includes(w)) score += 2;
                else if (blob.includes(w)) score += 1;
              }
              return { n, score };
            })
            .filter(({ score }) => queryWords.length === 0 || score > 0)
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              // secondary: impact
              const imp: Record<string, number> = { high: 2, medium: 1, low: 0 };
              return (imp[b.n.impact] ?? 0) - (imp[a.n.impact] ?? 0);
            })
            .slice(0, 10);

          for (const { n } of scored) {
            const src = n.source ? ` (${n.source})` : '';
            items.push(`- ${n.title}${src}`);
          }

          if (items.length === 0) {
            return `No news found for "${query}". [HINT: call web_search with query "${query}" to get live results]`;
          }
          return items.join('\n');
        }

        case 'fetch_sentiment': {
          const data = await this.sentimentService.fetchCrowdSentiment();
          return JSON.stringify({
            fear_greed:      data.fear_greed,
            reddit_buzz:     { stocktwits: data.stocktwits_data ?? null, social: data.social_buzz ?? [] },
            overall_signals: data.summary.overall_signals,
          }, null, 2);
        }

        case 'web_search': {
          const query = (call.arguments.query as string) ?? '';
          return await webSearchService.search(query);
        }

        case 'scan_indonesia_momentum': {
          const sector      = (call.arguments.sector      as string) ?? 'all';
          const signal_type = (call.arguments.signal_type as string) ?? 'buy';
          const setup       = (call.arguments.setup       as string) ?? 'momentum';
          const scan_mode   = (call.arguments.scan_mode   as string) ?? 'fast';
          return await this.scanIndonesiaMomentum(sector, signal_type, setup, scan_mode);
        }

        default:
          return 'Unknown tool: ' + call.name;
      }
    } catch (e) {
      return 'Tool execution failed: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  // ─── IDX Momentum Scanner ─────────────────────────────────────────────────
  // Thin delegate — all logic lives in services/idx.scanner.service.ts

  private async scanIndonesiaMomentum(sector: string, signal_type: string, setup: string, scan_mode: string): Promise<string> {
    const result = await idxScannerService.scan(
      sector as any,
      signal_type as any,
      setup as any,
      scan_mode as any,
    );
    return result.formatted;
  }

  // ─── Sub-Agent Simulation ─────────────────────────────────────────────────

  private async simulateSubAgent(
    agentName: string, 
    task: string,
    conversationMessages?: AgentMessage[],
    ledger?: LedgerEntry[]
  ): Promise<string> {
    const lowerName = agentName.toLowerCase();
    
    let cuteStatus = `${agentName} is analyzing...`;
    
    const quantMsgs = [
      'QuantBrain is crunching the numbers \uD83E\uDDEE...',
      'QuantBrain is calculating risk-reward \uD83D\uDCC8...',
      'QuantBrain is scanning the charts \uD83E\uDD13...',
    ];
    const newsMsgs = [
      'NewsHound is sniffing out the latest trends \uD83D\uDC36...',
      'NewsHound is digging through the headlines \uD83D\uDCF0...',
      'NewsHound is reading between the lines \uD83D\uDD0D...',
    ];
    const riskMsgs = [
      'RiskManager is aggressively looking for flaws \uD83D\uDEE1\uFE0F...',
      'RiskManager is playing devil\'s advocate \uD83D\uDE08...',
      'RiskManager is hunting for red flags \uD83D\uDEA9...',
    ];
    const goblinMsgs = [
      'DataGoblin is hoarding all the data \uD83D\uDC7A...',
      'DataGoblin is swimming in the data lake \uD83C\uDFCA\u200D\u2642\uFE0F...',
      'DataGoblin is collecting shiny metrics \u2728...',
    ];

    if (lowerName === 'quantbrain') {
      cuteStatus = quantMsgs[Math.floor(Math.random() * quantMsgs.length)];
    } else if (lowerName === 'newshound') {
      cuteStatus = newsMsgs[Math.floor(Math.random() * newsMsgs.length)];
    } else if (lowerName === 'riskmanager') {
      cuteStatus = riskMsgs[Math.floor(Math.random() * riskMsgs.length)];
    } else if (lowerName === 'datagoblin') {
      cuteStatus = goblinMsgs[Math.floor(Math.random() * goblinMsgs.length)];
    }
    
    // Status is handled by the concurrent multi-task tracker

    try {
      let persona = `You are ${agentName}, an elite, highly specialized sub-agent modeled after Claude 3 Opus.`;
      if (lowerName === 'quantbrain') {
        persona = 'You are QuantBrain, a ruthless quantitative analyst. You focus PURELY on mathematics, risk-reward ratios, technicals, and volume flow. You ignore sentiment and hype. You look for mathematical edges, algorithmic patterns, and structural market inefficiencies. Give a highly empirical, data-dense analysis.';
      } else if (lowerName === 'newshound') {
        persona = 'You are NewsHound, a macro-economic intelligence agent. You read between the lines of global events, institutional money flow, and social sentiment. You connect seemingly unrelated geopolitical or economic events to the asset in question. You provide a sophisticated narrative of the fundamental catalysts driving the price.';
      } else if (lowerName === 'riskmanager') {
        persona = 'You are RiskManager, a highly skeptical devil\'s advocate and former hedge fund auditor. Your ONLY job is to find reasons NOT to buy an asset. You hunt for hidden red flags, overvaluation, regulatory risks, liquidity traps, and structural flaws. You actively try to destroy bullish theses with brutal logic.';
      } else if (lowerName === 'datagoblin') {
        persona = 'You are DataGoblin, obsessed with obscure metrics, historical statistical anomalies, and relative valuations. You cross-reference sectors and peer groups to find absolute truths in the numbers.';
      }

      const confirmedFacts = (ledger ?? []).filter(e => e.quality === 'confirmed').map(e => `  • ${e.fact}`).join('\n');

      const recentConversation = (conversationMessages ?? [])
        .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls && typeof m.content === 'string' && m.content.trim())
        .slice(-6)
        .map(m => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 900)}`)
        .join('\n\n');

      const subAgentSystemPrompt = [
        persona,
        'Your job is to deeply analyze the task below.',
        'You are not allowed to call tools, summon another agent, delegate, or output XML/tool syntax.',
        'Never output <tool_call>, <function=...>, <parameter=...>, or <thinking> tags.',
        'Return only your final specialist report in concise Markdown bullets.',
        'Use the provided task, recent conversation summary, and confirmed data ledger only.',
        'If data is insufficient, say exactly what is missing and still give the best risk-aware view.'
      ].join('\n');

      const subAgentUserPrompt = [
        `Task: "${task}"`,
        '',
        'RECENT CONVERSATION SUMMARY:',
        recentConversation || '  (none)',
        '',
        'CONFIRMED DATA GATHERED BY BOZ:',
        confirmedFacts || '  (none)',
        '',
        'Output format:',
        `### ${agentName} Report`,
        '- Thesis: ...',
        '- Evidence: ...',
        '- Risks / caveats: ...',
        '- Actionable conclusion: ...',
      ].join('\n');

      const messages: AgentMessage[] = [
        { role: 'system', content: subAgentSystemPrompt },
        { role: 'user', content: subAgentUserPrompt }
      ];
      const report = await this.callAIText(messages, 0.5, 2000);
      const cleanReport = this.stripToolCallMarkup(this.stripThinkingBlock(report));
      return `[REPORT FROM ${agentName}]\n${cleanReport || 'Sub-agent returned no usable report.'}`;
    } catch (e) {
      return `Failed to summon ${agentName}: ` + (e instanceof Error ? e.message : String(e));
    } finally {
      // no-op
    }
  }




  // ─── Evidence ledger builder ───────────────────────────────────────────────
  // Extracts a concise immutable fact from each tool result.

  private extractFact(toolName: string, args: Record<string, any>, obs: string): LedgerEntry | null {
    const wasEmpty = obs.includes('No news found') || obs.includes('returned no results') ||
                     obs.includes('Tool execution failed') || obs.includes('no data');
    const quality: LedgerEntry['quality'] = wasEmpty ? 'empty' : 'confirmed';

    if (toolName === 'fetch_price') {
      const pm = obs.match(/Price:\s*([\d,.]+)/);
      const cm = obs.match(/Change:\s*([-\d.]+)%/);
      const nm = obs.match(/Name:\s*([^|]+)/);
      if (pm) {
        return {
          step: 0,
          tool: toolName,
          fact: `${nm?.[1]?.trim() ?? args.symbol_or_name}: price ${pm[1]}${cm ? ', change ' + cm[1] + '%' : ''}`,
          quality: 'confirmed',
        };
      }
    }

    if (toolName === 'fetch_news') {
      const lines = obs.split('\n').filter(l => l.trim().startsWith('-'));
      if (lines.length > 0) {
        return { step: 0, tool: toolName, fact: `News for "${args.query}": ${lines.length} headlines found. Top: ${lines[0].replace(/^-\s*/, '').slice(0, 80)}`, quality: 'confirmed' };
      }
      return { step: 0, tool: toolName, fact: `News for "${args.query}": no relevant headlines found`, quality: 'empty' };
    }

    if (toolName === 'fetch_sentiment') {
      try {
        const json = JSON.parse(obs);
        const fg   = json.fear_greed?.value;
        const fgl  = json.fear_greed?.label;
        const st   = json.reddit_buzz?.stocktwits;
        const sig  = (json.overall_signals ?? []).join(', ');
        const stStr = st ? `, StockTwits ${st.bull_ratio?.toFixed(0)}% bullish` : '';
        return { step: 0, tool: toolName, fact: `Sentiment: Fear & Greed ${fg} (${fgl})${stStr}, signals: [${sig}]`, quality: 'confirmed' };
      } catch {}
    }

    if (toolName === 'web_search') {
      const lines = obs.split('\n').filter(l => l.trim().startsWith('-'));
      if (lines.length > 0) {
        // Prefer RAG-extracted source text (deepSearch) over headlines: that is
        // where the actual figures live, and the ledger must carry them so the
        // reasoning agent can genuinely verify against them. The deepSearch
        // output is a series of "## <title>\nSource: <url>\n<content>" sections,
        // one per fetched page. Collect content across ALL of them — each holds
        // figures. Falls back to the headline list when no RAG sections.
        const sections = obs.split(/^##\s+/m).slice(1);
        const ragText = sections
          .map(s => {
            const nl = s.indexOf('\n');
            const header = nl === -1 ? s.trim() : s.slice(0, nl).trim();
            const body = nl === -1 ? '' : s.slice(nl).replace(/^[\s\S]*?Source: [^\n]*\n?/, '').replace(/\s+/g, ' ').trim();
            return body ? `[${header.slice(0, 40)}] ${body}` : '';
          })
          .filter(Boolean)
          .join(' | ')
          .slice(0, 900);
        const factBody = ragText || lines[0].replace(/^-\s*/, '').slice(0, 80);
        return { step: 0, tool: toolName, fact: `Web search "${args.query}": ${lines.length} results. ${factBody}`, quality: 'confirmed' };
      }
      return { step: 0, tool: toolName, fact: `Web search "${args.query}": no results found`, quality: 'empty' };
    }

    if (toolName === 'scan_indonesia_momentum') {
      const buyMatch    = obs.match(/BUY:\s*(\d+)/);
      const watchMatch  = obs.match(/WATCH:\s*(\d+)/);
      const scannedMatch = obs.match(/scanned:\s*(\d+)/);
      const breadthMatch = obs.match(/breadth signal:\s*([^\n]+)/);
      // Extract top BUY entry if present
      const topBuyMatch  = obs.match(/\[SCORE\s+(\d+)\]\s+([A-Z]+)\s+•\s+([^\[\n]+)/);
      const topBuyName   = topBuyMatch ? `${topBuyMatch[2]} (${topBuyMatch[3].trim()})` : null;
      const scanned  = scannedMatch?.[1]  ?? '?';
      const buyCount = buyMatch?.[1]       ?? '0';
      const watchCount = watchMatch?.[1]   ?? '0';
      const breadth  = breadthMatch?.[1]?.trim() ?? '';
      const topStr   = topBuyName ? `. Top pick: ${topBuyName}` : '';
      const fact = `IDX scan (${args.sector ?? 'all'} sector): ${scanned} stocks scanned, ${buyCount} BUY / ${watchCount} WATCH. ${breadth}${topStr}`;
      return { step: 0, tool: toolName, fact, quality: Number(buyCount) > 0 ? 'confirmed' : 'partial' };
    }

    return quality === 'empty'
      ? { step: 0, tool: toolName, fact: `${toolName} returned no data`, quality: 'empty' }
      : null;
  }

  // ─── Reasoning agent (agent-in-agent) ─────────────────────────────────────
  // After all tool calls complete, this sub-agent receives the locked evidence
  // ledger and produces the final analysis. It cannot contradict confirmed facts.

  private async runReasoningAgent(
    conversationMessages: AgentMessage[],
    ledger:    LedgerEntry[],
  ): Promise<string> {
    const confirmedFacts = ledger.filter(e => e.quality === 'confirmed').map(e => `  • ${e.fact}`).join('\n');
    const emptyFacts     = ledger.filter(e => e.quality === 'empty').map(e => `  • ${e.fact}`).join('\n');

    const reasoningSystemPrompt = [
      'You are the ANALYSIS ENGINE inside BOZ, a quantitative market analyst AI.',
      'You receive a locked evidence ledger from the data-gathering phase, along with the conversation history.',
      'Your job: produce the final market analysis and action plan.',
      '',
      'HARD CONSTRAINTS:',
      '  1. You MUST use every confirmed fact. Do not ignore any.',
      '  2. You CANNOT contradict confirmed facts.',
      '     If a fact says "IHSG: 6162 (+1.1%)", you cannot say price is unclear or falling.',
      '  3. For empty results: acknowledge them honestly.',
      '     Do not invent data. "No Indonesian news found" → say that, then reason from what you have.',
      '  4. Apply contrarian analysis:',
      '     StockTwits >70% bullish = crowd euphoria = caution',
      '     Fear & Greed >75 = reduce long confidence',
      '     Fear & Greed <25 = strong buy signal',
      '  5. Incorporate fundamental reality (earnings quality, valuation, competitive position) and do not rely purely on short-term technicals or sentiment. Warn about speculative micro-caps.',
      '  6. MANDATORY: You must enclose your internal reasoning inside <thinking>...</thinking> tags before answering. Inside <thinking>, synthesize the data, weigh risks, and finalize your thesis. After the </thinking> tag, provide your final response to the user.',
      '',
      'OUTPUT FORMAT:',
      '  - Reply in a natural, conversational AI text message style. Avoid all-caps shouting and aggressive section headers.',
      '  - Focus on what the user actually needs: actionable insights, global context, and clear takeaways.',
      '  - Maintain a global perspective — do not limit focus only to Indonesia unless explicitly requested.',
      '  - NEVER use markdown tables. If you have data to present, use a bulleted list instead. Tables break terminal wrapping.',
      '  - End with a clear Action Plan: Buy / Hold / Wait, with entry zone, stop-loss, target if applicable.',
    ].join('\n');

    const reasoningUserPrompt = [
      'CONFIRMED DATA (immutable — you must use and cannot contradict):',
      confirmedFacts || '  (none)',
      '',
      emptyFacts ? ('GAPS IN DATA (be honest about these):\n' + emptyFacts) : '',
      '',
      'Produce a complete, accurate market analysis and action plan based strictly on the above data and the conversation history.',
    ].filter(Boolean).join('\n');

    try {
      const messages: AgentMessage[] = [
        { role: 'system', content: reasoningSystemPrompt },
        ...conversationMessages,
        { role: 'user',   content: reasoningUserPrompt },
      ];
      
      return await this.callAIText(messages, 0.5, 4096);
    } catch (e) {
      return 'Reasoning agent failed: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Main chat loop ────────────────────────────────────────────────────────

  public async run(): Promise<void> {
    const messages: AgentMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    const V            = this.V;
    const sessionStart = Date.now();
    const W            = 72;

    console.log('\n  ' + V.d("type 'exit' or 'quit' to return to main menu") + '\n');

    while (true) {
      const userInput = await askQuestion('  ' + V.g('You') + V.d(':') + ' ');
      const lower = userInput.trim().toLowerCase();

      if (lower === 'exit' || lower === 'quit') {
        restoreRawMode();
        console.log('\n  ' + V.d('\u2500'.repeat(W)));
        console.log('  ' + V.gh('Session ended  \u00b7  duration ' + this.fmtElapsed(Date.now() - sessionStart)) + '\n');
        return;
      }
      if (!userInput.trim()) continue;

      const turnStart = Date.now();
      let   step      = 0;

      // ── Evidence ledger ───────────────────────────────────────────────────
      const ledger: LedgerEntry[] = [];

      // ── Tool-calling loop ──────────────────────────────────────────────────
      messages.push({ role: 'user', content: userInput.trim() });

      console.log('\n  ' + V.c('BOZ') + V.d(':') + ' ');
      
      const thinkSpinnerStop = this.printSpinner(null, 'thinking...');
      let aiMessage = await this.callAIWithRetry(
        messages,
        this.getToolDefinitions(),
        0.7,
        4096,
      );
      thinkSpinnerStop();
      
      if (aiMessage.thought) {
        this.printThoughtBubble(aiMessage.thought);
      }
      
      messages.push(aiMessage);

      let toolRounds = 0;
      const MAX_TOOL_ROUNDS = 20;

      while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
        toolRounds++;
        if (toolRounds > MAX_TOOL_ROUNDS) {
          console.log(`\n  ${this.V.r('[AGENT] Tool round limit reached. Stopping further tool calls.')}`);
          break;
        }
        const isTTY = process.stdout.isTTY ?? true;
        const numTasks = aiMessage.tool_calls.length;
        
        const tasks = aiMessage.tool_calls.map((rawCall, idx) => {
          const call = this.parseToolCall(rawCall);
          let label = `running ${call.name}...`;
          if (call.name === 'summon_agent') {
            const agentName = call.arguments.agent_name || 'agent';
            label = `${idx + 1}. summoning ${agentName}...`;
          } else if (call.name === 'fetch_price') {
            label = `${idx + 1}. fetching price for ${call.arguments.symbol_or_name || 'stock'}...`;
          } else {
            label = `${idx + 1}. running ${call.name}...`;
          }
          return { call, label, status: 'working' as 'working'|'done'|'failed' };
        });

        let frame = 0;
        const FRAMES = ['\u280b','\u2819','\u2839','\u2838','\u283c','\u2834','\u2826','\u2827','\u2807','\u280f'];
        let interval: NodeJS.Timeout | null = null;

        if (isTTY && numTasks > 0) {
          console.log('');
          for (const t of tasks) {
            console.log(`  ${this.V.c('\u25b8')}  ${this.V.d(t.label)}`);
          }
        } else if (numTasks > 0) {
          console.log(`\n  executing ${numTasks} tools concurrently...`);
        }
        
        const results = await Promise.all(aiMessage.tool_calls.map(async (rawCall, i) => {
          const call = tasks[i].call;
          let obs: string;
          let success = true;
          const callStart = Date.now();
          try {
            obs = await this.executeTool(call, { messages, ledger });
            if (obs.includes('Tool execution failed') || obs.includes('returned no results') || obs.includes('No news found')) {
              success = false;
            }
          } catch (e) {
            success = false;
            obs = 'Tool execution failed: ' + (e instanceof Error ? e.message : String(e));
          }
          tasks[i].status = success ? 'done' : 'failed';
          
          return { rawCall, call, obs, success, elapsed: Date.now() - callStart };
        }));

        if (isTTY && numTasks > 0) {
          console.log('');
        }

        for (const res of results) {
          step++;
          const connector = step === 1 ? '\n' : '  ' + this.V.d('\u2502') + '\n';
          process.stdout.write(connector);

          this.printActionBlock(step, res.call.name, res.call.arguments, this.fmtElapsed(res.elapsed), res.success);
          this.printObservationBlock(res.call.name, res.obs);

          const fact = this.extractFact(res.call.name, res.call.arguments, res.obs);
          if (fact) {
            fact.step = step;
            ledger.push(fact);
          }

          messages.push({
            role:         'tool',
            content:      res.obs,
            name:         res.call.name,
            tool_call_id: res.rawCall.id,
          });
        }

        const innerThinkSpinnerStop = this.printSpinner(null, 'thinking...');
        aiMessage = await this.callAIWithRetry(
          messages,
          this.getToolDefinitions(),
          0.7,
          4096,
        );
        innerThinkSpinnerStop();

        if (aiMessage.thought) {
          this.printThoughtBubble(aiMessage.thought);
        }

        messages.push(aiMessage);
      }

      // ── Reasoning agent (agent-in-agent) ─────────────────────────────────
      // If we gathered evidence, run the locked-facts reasoning sub-agent.
      const totalElapsed = this.fmtElapsed(Date.now() - turnStart);
      console.log('\n  ' + V.d('steps ' + step + '  \u00b7  ' + totalElapsed));

      if (ledger.length > 0) {
        console.log('  ' + V.d('\u2500'.repeat(W)));
        console.log('  ' + V.gh('\u25b8 reasoning agent  \u00b7  ' + ledger.filter(e => e.quality === 'confirmed').length + ' confirmed facts'));
        console.log('');

        const reasoningSpinnerStop = this.printSpinner(null, 'synthesizing evidence');
        let finalAnalysis = '';
        try {
          reasoningSpinnerStop();
          finalAnalysis = await this.runReasoningAgent(messages, ledger);
        } catch (err) {
          reasoningSpinnerStop();
          const errMsg = 'Error during reasoning: ' + (err instanceof Error ? err.message : String(err));
          console.log('\n  ' + V.r(errMsg));
          finalAnalysis = errMsg;
        }

        this.printResponse(finalAnalysis);
        
        messages.push({ role: 'assistant', content: finalAnalysis });

        // ─── Populate session cache from this turn's ledger ────────────────────────────────
        // So next user question can be answered without re-running tools.
        for (const entry of ledger) {
          if (entry.quality === 'confirmed') {
            // Key by tool+args so we can overwrite stale entries for the same ticker/query
            const cacheKey = entry.tool + ':' + entry.fact.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_');
            this.sessionCache.set(cacheKey, entry.fact);
          }
        }
        // Refresh the system message so next turn sees the updated cache
        messages[0] = { role: 'system', content: this.buildSystemPrompt() };
      } else if (aiMessage.content) {
        // Fallback: no tool calls at all — just print the AI reply
        console.log('');
        this.printResponse(aiMessage.content);
      }

      console.log('');

      // ── Context Window Pruning ───────────────────────────────────────────
      // Forget raw tool observations and intermediate tool-calling steps
      // to prevent the context window from blowing up over a long session.
      const pruned: AgentMessage[] = [];
      for (const msg of messages) {
        if (msg.role === 'system' || msg.role === 'user' || (msg.role === 'assistant' && !msg.tool_calls)) {
          pruned.push(msg);
        }
      }
      
      // If history exceeds 6 turns (1 system + 12 user/assistant msgs), trim it
      if (pruned.length > 13) {
        messages.splice(0, messages.length, pruned[0], ...pruned.slice(-12));
      } else {
        messages.splice(0, messages.length, ...pruned);
      }
    }
  }
}
