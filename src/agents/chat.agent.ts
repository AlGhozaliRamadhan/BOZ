import { BaseAgent, ParsedToolCall, AgentMessage } from './base.agent.js';
import { askQuestion, restoreRawMode } from '../cli/cli.js';
import { newsFetchService } from '../services/news.fetch.service.js';
import { yahooFinance } from '../services/yahoo.service.js';
import { SentimentService } from '../services/sentiment.service.js';
import { resolveSymbol } from '../shared/market-constants.js';

export class InteractiveChatAgent extends BaseAgent {
  private sentimentService = new SentimentService();

  constructor() {
    super();
  }

  // ─── ANSI palette & helpers ───────────────────────────────────────────────

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

  // ─── Elapsed formatter ────────────────────────────────────────────────────

  private fmtElapsed(ms: number): string {
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    return Math.floor(s / 60) + 'm' + String(Math.floor(s % 60)).padStart(2, '0') + 's';
  }

  // ─── Action header ────────────────────────────────────────────────────────

  private printActionBlock(
    step:     number,
    toolName: string,
    args:     Record<string, any>,
    elapsed:  string,
  ): void {
    const V = this.V;
    const argStr = Object.values(args).join(' \u00b7 ');
    const label  = argStr
      ? toolName + '  ' + V.d('\u00b7') + '  ' + V.gh(argStr)
      : toolName;
    console.log('\n  ' + V.d('\u251c\u2500') + ' ' + V.c('[step ' + step + ']') + '  ' + V.w(label) + '  ' + V.d(elapsed));
  }

  // ─── Observation rows ─────────────────────────────────────────────────────

  private printObservationBlock(toolName: string, obs: string): void {
    const V     = this.V;
    const lines = this.formatObservation(toolName, obs);
    if (!lines.length) {
      console.log('  ' + V.d('\u2502') + '  ' + V.gh('(no data)'));
      return;
    }
    for (const ln of lines)
      console.log('  ' + V.d('\u2502') + '  ' + ln);
  }

  // ─── Inline spinner ───────────────────────────────────────────────────────

  private printSpinner(msg: string): () => void {
    const FRAMES = ['\u280b','\u2819','\u2839','\u2838','\u283c','\u2834','\u2826','\u2827','\u2807','\u280f'];
    const V      = this.V;
    let   i      = 0;
    const isTTY  = process.stdout.isTTY ?? true;

    process.stdout.write('  ' + V.d('\u2502') + '  ' + V.gh(msg) + '  ' + V.d(FRAMES[0]));
    if (!isTTY) { process.stdout.write('\n'); return () => {}; }

    const tid = setInterval(() => {
      i = (i + 1) % FRAMES.length;
      process.stdout.write('\r  ' + V.d('\u2502') + '  ' + V.gh(msg) + '  ' + V.d(FRAMES[i]));
    }, 80);

    return () => { clearInterval(tid); process.stdout.write('\r\x1b[K'); };
  }

  // ─── Response header / footer ──────────────────────────────────────────────

  private printResponseHeader(): void { return; }
  private printResponseFooter(): void { return; }

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
      for (const item of items.slice(0, 4)) {
        const clean = item.replace(/^-\s*/, '').trim();
        const display = clean.length > 70 ? clean.slice(0, 67) + '\u2026' : clean;
        lines.push(V.d('\u00b7') + ' ' + V.gh(display));
      }
      if (!items.length) lines.push(V.gh('No headlines found.'));
    } else if (toolName === 'fetch_sentiment') {
      try {
        const json = JSON.parse(raw);
        const fg = json.fear_greed;
        const sig = (json.overall_signals ?? []).join('  ');
        const st = json.reddit_buzz?.stocktwits;

        if (fg) {
          const fgVal = fg.value ?? fg.score ?? '?';
          const fgLabel = fg.classification ?? fg.label ?? '';
          const fgCol = Number(fgVal) >= 70 ? V.r : Number(fgVal) >= 50 ? V.y : V.c;
          lines.push(V.gh('fear/greed  ') + fgCol(String(fgVal)) + '  ' + V.d(fgLabel));
        }
        if (st) {
          const bp    = st.bull_ratio != null ? st.bull_ratio.toFixed(0) : (st.bullish_percent ?? st.bullish ?? '?');
          const bulls = st.bullish ?? st.bulls ?? st.bullish_count ?? '?';
          const bears = st.bearish ?? st.bears ?? st.bearish_count ?? '?';
          const tot   = st.total_with_sentiment ?? st.total ?? '?';
          lines.push(V.gh('stocktwits  ') + V.g(bp + '% bullish') + '  ' + V.d('bulls ' + bulls + ' \u00b7 bears ' + bears + ' \u00b7 total ' + tot));
        }
        if (sig) lines.push(V.gh('signals     ') + V.c(sig));
      } catch {
        lines.push(V.gh(raw.slice(0, 90)));
      }
    } else {
      lines.push(V.gh(raw.slice(0, 90)));
    }

    return lines;
  }

  // ─── Final response printer ────────────────────────────────────────────────

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

  private isMarkdownTableSeparator(line: string): boolean {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
  }

  private formatMarkdownTable(rows: string[]): string[] {
    const parsed = rows
      .map(row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => this.stripInlineMarkdown(cell.trim())))
      .filter(cells => cells.length > 0);

    if (parsed.length < 2) return rows.map(row => this.stripInlineMarkdown(row));

    const header = parsed[0];
    const body = parsed.slice(2).length ? parsed.slice(2) : parsed.slice(1);
    const columnCount = Math.max(...parsed.map(cells => cells.length));
    const widths = new Array(columnCount).fill(0).map((_, col) =>
      Math.max(...parsed.map(cells => (cells[col] ?? '').length), 0),
    );

    const padRow = (cells: string[]): string =>
      cells.map((cell, index) => (cell ?? '').padEnd(widths[index])).join('  ');

    const separator = widths.map(width => '-'.repeat(Math.max(width, 3))).join('  ');
    const lines = [padRow(header), separator];
    for (const row of body) lines.push(padRow(row));
    return lines;
  }

  private printResponse(text: string): void {
    const V = this.V;
    const W = 76;
    const blocks = (text ?? '').trim().split(/\n{2,}/).map(block => block.trim()).filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n').map(line => line.trimEnd());
      const isTable = lines.length >= 2 && lines[0].includes('|') && this.isMarkdownTableSeparator(lines[1]);

      if (isTable) {
        const tableLines = this.formatMarkdownTable(lines.slice(0, Math.min(lines.length, 12)));
        for (const line of tableLines) console.log('  ' + V.d(line));
        console.log('');
        continue;
      }

      for (const rawLine of lines) {
        const t = this.stripInlineMarkdown(rawLine).trim();
        if (!t) { console.log(''); continue; }

        if (/^[A-Z][A-Z\s\(\)\-:&\/]{4,}$/.test(t)) {
          console.log('\n  ' + V.b(V.w(t)));
          continue;
        }

        if (/^[-•*]\s/.test(t) || /^\d+\.\s/.test(t)) {
          const m = t.match(/^([-•*]|\d+\.)\s/);
          const pfx = m ? m[0] : '- ';
          const content = t.slice(pfx.length);
          const words = content.split(/\s+/);
          let line = '';
          let first = true;
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

        const words = t.split(/\s+/);
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
      case 'fetch_price': {
        const raw    = (args.symbol_or_name as string) ?? '';
        const symbol = resolveSymbol(raw) || raw.toUpperCase();
        return 'fetching price for ' + symbol;
      }
      case 'fetch_news':      return 'fetching ' + (args.category ?? 'market') + ' news';
      case 'fetch_sentiment': return 'fetching crowd sentiment';
      default:                return 'running ' + toolName;
    }
  }

  // ─── System prompt ────────────────────────────────────────────────────────

  protected buildSystemPrompt(): string {
    return [
      'You are BOZ, an elite AI market assistant and quantitative analyst.',
      'Your goal is to converse with the user, answer their questions about markets, and give direct, analytical, actionable insights.',
      '',
      'You have three live tools: fetch_price, fetch_news, fetch_sentiment.',
      '',
      'CONVERSATION RULES — READ CAREFULLY:',
      '1. When the user sends a message, your VERY FIRST response must be a plain conversational acknowledgment.',
      '   - Speak directly to the user. Tell them what you understood and what you are going to check.',
      '   - Example: "Got it — you want me to scan the Indonesian market for buy opportunities. I\'ll pull the IHSG price, check recent market news, and read crowd sentiment, then give you a specific recommendation."',
      '   - This message MUST appear in your content field. NEVER start with a tool call before acknowledging.',
      '2. After acknowledging, use your tools to gather the data you mentioned.',
      '3. After all tools have returned results, write your full analytical conclusion.',
      '4. Formulate clear ACTION PLANS. State BUY, HOLD, or WAIT explicitly. Give entry, stop-loss, and target.',
      '5. Use ALL CAPS for section headers. Avoid ### markdown headers.',
      '6. Do not invent data. Only use tool outputs.',
      '7. Be concise and professional. No filler phrases.',
    ].join('\n');
  }

  protected buildInitialPrompt(): string {
    return '';
  }

  // ─── Tool definitions ─────────────────────────────────────────────────────

  protected getToolDefinitions(): object[] {
    return [
      {
        type: 'function',
        function: {
          name: 'fetch_price',
          description: 'Fetch the current live market price for any asset.',
          parameters: {
            type: 'object',
            properties: {
              symbol_or_name: { type: 'string', description: 'e.g., BTC, AAPL, IHSG, BBCA, GOLD' },
            },
            required: ['symbol_or_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_news',
          description: 'Fetch recent market news headlines.',
          parameters: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['crypto', 'stocks', 'macro', 'broad'],
                description: 'News category to focus on.',
              },
            },
            required: ['category'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_sentiment',
          description: 'Fetch crowd sentiment — Fear & Greed index and StockTwits buzz.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
  }

  // ─── Tool executor ────────────────────────────────────────────────────────

  protected async executeTool(call: ParsedToolCall): Promise<string> {
    try {
      switch (call.name) {
        case 'fetch_price': {
          const raw    = call.arguments.symbol_or_name as string;
          const symbol = resolveSymbol(raw) || raw.toUpperCase();
          const quote  = await yahooFinance.quote(symbol);
          const price  = (quote as any).regularMarketPrice;
          const change = (quote as any).regularMarketChangePercent;
          if (price === undefined || price === null)
            return `No price data found for ${symbol}. Yahoo Finance may not support this symbol or market may be closed.`;
          const chgNum = typeof change === 'number' ? change : 0;
          const name   = (quote as any).shortName || (quote as any).longName || symbol;
          return `Symbol: ${symbol} | Name: ${name} | Price: ${price} (Change: ${chgNum.toFixed(2)}%)`;
        }
        case 'fetch_news': {
          const cat = call.arguments.category as string;
          let newsText = '';
          if (cat === 'crypto') {
            const data = await newsFetchService.fetchCryptoNews();
            newsText = data.slice(0, 5).map((n: any) => '- ' + n.title + ' (' + n.source + ')').join('\n');
          } else if (cat === 'stocks') {
            const data = await newsFetchService.fetchStockNews();
            newsText = data.slice(0, 5).map((n: any) => '- ' + n.title + ' (' + n.source + ')').join('\n');
          } else if (cat === 'macro') {
            const data = await newsFetchService.fetchMacroNews();
            newsText = data.slice(0, 5).map((n: any) => '- ' + n.title).join('\n');
          } else {
            const data = await newsFetchService.fetchBroadMarketNews();
            newsText = data.slice(0, 5).map((n: any) => '- ' + n.title).join('\n');
          }
          return newsText || 'No news found.';
        }
        case 'fetch_sentiment': {
          const data = await this.sentimentService.fetchCrowdSentiment();
          return JSON.stringify({
            fear_greed:      data.fear_greed,
            reddit_buzz:     {
              stocktwits: data.stocktwits_data ?? null,
              social:     data.social_buzz ?? [],
            },
            overall_signals: data.summary.overall_signals,
          }, null, 2);
        }
        default:
          return 'Unknown tool: ' + call.name;
      }
    } catch (e) {
      return 'Tool execution failed: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Acknowledgment prompt ────────────────────────────────────────────────
  //
  // Sent as a separate text-only call BEFORE the tool-calling loop.
  // This guarantees the user sees a real reply immediately, not a fallback.

  private buildAckPrompt(userInput: string): string {
    return (
      'The user just said: "' + userInput + '"\n\n' +
      'Write a SHORT (2–3 sentence) conversational acknowledgment:\n' +
      '- Confirm what you understood from their request.\n' +
      '- Tell them specifically which data points you are about to fetch (price, news, sentiment).\n' +
      '- Sound like a sharp analyst speaking to a client, not a robot.\n' +
      'Output ONLY the acknowledgment. No analysis yet. No tool calls. No headers.'
    );
  }

  // ─── Main chat loop ───────────────────────────────────────────────────────

  public async run(): Promise<void> {
    const messages: AgentMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    const V            = this.V;
    const sessionStart = Date.now();
    const W            = 72;
    const HEADER       = '  BOZ CHAT  ';
    const hFill        = W - HEADER.length;
    const hLeft        = Math.floor(hFill / 2);
    const hRight       = hFill - hLeft;

    console.log('\n  ' + V.m('\u2501'.repeat(hLeft) + HEADER + '\u2501'.repeat(hRight)));
    console.log('  ' + V.gh('AI Market Assistant  \u00b7  Live Tools  \u00b7  Agentic Mode'));
    console.log('  ' + V.d('\u2500'.repeat(W)));
    console.log('  ' + V.d("type 'exit' or 'quit' to return to main menu") + '\n');

    while (true) {
      const userInput = await askQuestion('  ' + V.g('You') + V.d(':') + ' ');
      const lower = userInput.trim().toLowerCase();

      if (lower === 'exit' || lower === 'quit') {
        restoreRawMode();
        const dur = this.fmtElapsed(Date.now() - sessionStart);
        console.log('\n  ' + V.d('\u2500'.repeat(W)));
        console.log('  ' + V.gh('Session ended  \u00b7  duration ' + dur) + '\n');
        return;
      }

      if (!userInput.trim()) continue;

      const turnStart = Date.now();
      let   step      = 0;

      // ── Step 1: Acknowledgment (text-only call, no tools) ─────────────────
      // This gives the user a real reply before any tool work begins.
      const ackMessages: AgentMessage[] = [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user',   content: this.buildAckPrompt(userInput.trim()) },
      ];

      let ackText = '';
      try {
        ackText = await this.callAIText(ackMessages, 0.7, 300);
      } catch {
        ackText = 'On it — pulling live data for you now.';
      }

      // Print the acknowledgment immediately, like a real chat reply
      console.log('\n  ' + V.c('BOZ') + V.d(':') + ' ');
      this.printResponse(ackText);

      // ── Step 2: Push user message and start tool-calling loop ─────────────
      messages.push({ role: 'user', content: userInput.trim() });

      let aiMessage = await this.llm.callWithTools({
        messages,
        tools:       this.getToolDefinitions(),
        temperature: 0.7,
      });
      messages.push(aiMessage);

      // Tool loop — run silently (no repeated BOZ: headers, just steps + obs)
      while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {

        for (const rawCall of aiMessage.tool_calls) {
          const call    = this.parseToolCall(rawCall);
          step++;
          const elapsed = this.fmtElapsed(Date.now() - turnStart);

          this.printActionBlock(step, call.name, call.arguments, elapsed);

          const stopSpinner = this.printSpinner(this.toolFetchLabel(call.name, call.arguments));
          let obs: string;
          try {
            obs = await this.executeTool(call);
          } finally {
            stopSpinner();
          }

          this.printObservationBlock(call.name, obs);

          messages.push({
            role:         'tool',
            content:      obs,
            name:         call.name,
            tool_call_id: rawCall.id,
          });
        }

        // Next AI reasoning step
        aiMessage = await this.llm.callWithTools({
          messages,
          tools:       this.getToolDefinitions(),
          temperature: 0.7,
        });
        messages.push(aiMessage);
      }

      // ── Step 3: Final analytical answer ───────────────────────────────────
      if (aiMessage.content) {
        const totalElapsed = this.fmtElapsed(Date.now() - turnStart);
        this.printResponseHeader();
        console.log('\n  ' + V.d('steps ' + step + '  \u00b7  ' + totalElapsed) + '\n');
        this.printResponse(aiMessage.content);
        this.printResponseFooter();
        console.log('');
      }
    }
  }
}
