import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { IntradayAnalyzer } from '../analyzers/intraday.analyzer.js';
import { LongTermAnalyzer } from '../analyzers/longterm.analyzer.js';
import { NewsIntelAnalyzer } from '../analyzers/news.intel.analyzer.js';
import { NewsIntelAgent } from '../agents/news.intel.agent.js';
import { InteractiveChatAgent } from '../agents/chat.agent.js';
import { config, type AIProvider } from '../config/config.js';
import { githubConfig, GITHUB_TOKEN_URL, GITHUB_MODELS } from '../config/github.config.js';
import { nvidiaConfig, NVIDIA_MODELS, NVIDIA_API_KEY_URL } from '../config/nvidia.config.js';
import { resolveSymbol } from '../shared/market-constants.js';
import { yahooFinance } from '../services/market/yahoo.service.js';
import { getBuildVersion } from '../utils/version.js';

// ─── Version ──────────────────────────────────────────────────────────────────

const BUILD_VERSION = getBuildVersion();

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeypressEvent {
  sequence: string;
  name: string;
  ctrl: boolean;
  meta: boolean;
}

interface Command {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<void>;
}

// ─── ANSI Utilities ───────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  ghost:  '\x1b[90m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  white:  '\x1b[97m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
  wrap: (color: string, text: string) => `${color}${text}\x1b[0m`,
} as const;


function renderHPicker(options: string[], selected: number): void {
  const parts = options.map((opt, i) =>
    i === selected
      ? `${c.white}> ${opt}${c.reset}`
      : `${c.ghost}  ${opt}${c.reset}`,
  );
  process.stdout.write(`\r\x1b[K  ${parts.join('     ')}`);
}

export function hPick(options: string[], defaultIdx = 0): Promise<number> {
  return new Promise((resolve) => {
    let sel = defaultIdx;
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
    readline.emitKeypressEvents(process.stdin);
    renderHPicker(options, sel);

    function onKey(_: unknown, key: any) {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { process.stdout.write('\n  Bye.\n'); process.exit(0); }
      if (key.name === 'left')  { sel = (sel - 1 + options.length) % options.length; renderHPicker(options, sel); return; }
      if (key.name === 'right') { sel = (sel + 1) % options.length;                  renderHPicker(options, sel); return; }
      if (key.name === 'return' || key.name === 'enter') {
        process.stdin.removeListener('keypress', onKey);
        process.stdout.write('\n');
        resolve(sel);
      }
    }
    process.stdin.on('keypress', onKey);
  });
}

function renderVPicker(options: string[], selected: number, indent: string): void {
  options.forEach(() => process.stdout.write('\x1b[1A\x1b[K'));
  options.forEach((opt, i) => {
    const marker = i === selected ? c.wrap(c.white, '>') : ' ';
    const text   = i === selected ? c.wrap(c.white, opt) : c.wrap(c.ghost, opt);
    process.stdout.write(`${indent}${marker} ${text}\n`);
  });
}

function vPick(options: string[], defaultIdx = 0, indent = '    '): Promise<number> {
  return new Promise((resolve) => {
    let sel = defaultIdx;
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
    readline.emitKeypressEvents(process.stdin);

    options.forEach((opt, i) => {
      const marker = i === sel ? c.wrap(c.white, '>') : ' ';
      const text   = i === sel ? c.wrap(c.white, opt) : c.wrap(c.ghost, opt);
      process.stdout.write(`${indent}${marker} ${text}\n`);
    });

    function onKey(_: unknown, key: any) {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { process.stdout.write('\n  Bye.\n'); process.exit(0); }
      if (key.name === 'up')   { sel = (sel - 1 + options.length) % options.length; renderVPicker(options, sel, indent); return; }
      if (key.name === 'down') { sel = (sel + 1) % options.length;                  renderVPicker(options, sel, indent); return; }
      if (key.name === 'return' || key.name === 'enter') {
        process.stdin.removeListener('keypress', onKey);
        resolve(sel);
      }
    }
    process.stdin.on('keypress', onKey);
  });
}

// ─── Plain text question ──────────────────────────────────────────────────────

export function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

export function restoreRawMode(): void {
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
  readline.emitKeypressEvents(process.stdin);
}

// ─── Mascot ───────────────────────────────────────────────────────────────────

type TickerSearchCandidate = {
  symbol: string;
  label: string;
};

function labelTickerCandidate(
  symbol: string,
  name: string,
  details: Array<string | number | null | undefined>,
): TickerSearchCandidate {
  const meta = details
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .map(String)
    .join(' · ');
  const labelParts = [symbol, name.trim(), meta].filter(Boolean);

  return {
    symbol,
    label: labelParts.join('  ·  '),
  };
}

function formatTickerCandidate(quote: any): TickerSearchCandidate | null {
  const symbol = resolveSymbol(String(quote?.symbol ?? ''));
  if (!symbol) return null;

  const name = String(quote?.shortname ?? quote?.longname ?? quote?.name ?? '').trim();
  return labelTickerCandidate(symbol, name, [quote?.quoteType, quote?.exchDisp ?? quote?.exchange]);
}

async function validateDirectTicker(symbol: string): Promise<TickerSearchCandidate | null> {
  try {
    const quote = await yahooFinance.quote(symbol);
    const quoteSymbol = resolveSymbol(String((quote as any)?.symbol ?? symbol)) ?? symbol;
    const name = String((quote as any)?.shortName ?? (quote as any)?.longName ?? '').trim();
    const price = typeof (quote as any)?.regularMarketPrice === 'number'
      ? `$${(quote as any).regularMarketPrice.toFixed(2)}`
      : null;

    return labelTickerCandidate(quoteSymbol, name, [
      'validated',
      (quote as any)?.quoteType,
      (quote as any)?.fullExchangeName ?? (quote as any)?.exchange,
      price,
    ]);
  } catch {
    return null;
  }
}

async function searchTickerCandidates(query: string): Promise<TickerSearchCandidate[]> {
  const direct = resolveSymbol(query);
  const seen = new Set<string>();
  const candidates: TickerSearchCandidate[] = [];

  const addCandidate = (candidate: TickerSearchCandidate, toFront = false) => {
    if (seen.has(candidate.symbol)) return;
    seen.add(candidate.symbol);
    if (toFront) candidates.unshift(candidate);
    else candidates.push(candidate);
  };

  let searchError: unknown = null;
  try {
    const result = await yahooFinance.search(query, { quotesCount: 8, newsCount: 0 });

    for (const quote of ((result as any)?.quotes ?? [])) {
      const candidate = formatTickerCandidate(quote);
      if (candidate) addCandidate(candidate);
    }
  } catch (err) {
    searchError = err;
  }

  if (direct) {
    const exactIdx = candidates.findIndex((candidate) => candidate.symbol === direct);
    if (exactIdx >= 0) {
      const [exact] = candidates.splice(exactIdx, 1);
      exact.label = `${exact.label}  ·  exact match`;
      candidates.unshift(exact);
    } else {
      const validated = await validateDirectTicker(direct);
      if (validated) addCandidate(validated, true);
    }
  }

  if (searchError && candidates.length === 0) throw searchError;

  return candidates;
}

async function promptForMarketTicker(): Promise<string | null> {
  const tickerIdx = await vPick([
    'Search ticker / asset',
    'NVDA (Nvidia Corp)',
    'SPY (S&P 500 ETF)',
  ]);

  if (tickerIdx === 1) return 'NVDA';
  if (tickerIdx === 2) return 'SPY';

  process.stdout.write('\n');

  while (true) {
    const raw = await askQuestion(`  Search ticker or asset: `);

    if (!raw.trim()) {
      process.stdout.write(`  ${c.wrap(c.red, 'Search cannot be empty.')}\n`);
    } else {
      try {
        process.stdout.write(`  ${c.wrap(c.ghost, 'Searching and validating Yahoo Finance matches...')}\n\n`);
        const candidates = await searchTickerCandidates(raw);

        if (candidates.length > 0) {
          process.stdout.write(
            `  ${c.wrap(c.ghost, 'Match')}  ` +
            `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
          );
          const matchIdx = await vPick(candidates.map((candidate) => candidate.label));
          return candidates[matchIdx].symbol;
        }

        process.stdout.write(`  ${c.wrap(c.red, `No symbol found for "${raw}".`)}\n`);
      } catch (err) {
        process.stdout.write(
          `  ${c.wrap(c.red, 'Ticker search failed:')} ` +
          `${c.wrap(c.ghost, err instanceof Error ? err.message : String(err))}\n`,
        );
      }
    }

    const retry = await askQuestion(`  Try another search? [Y/n]: `);
    if (retry.toLowerCase().startsWith('n')) {
      restoreRawMode();
      return null;
    }
  }
}

function printMascot(): void {
  const W  = c.wrap;
  const Wh = (s: string) => W(c.white,  s);
  const Gh = (s: string) => W(c.ghost,  s);
  const Di = (s: string) => W(c.dim,    s);
  const Ye = (s: string) => W(c.yellow, s);

  process.stdout.write('\n');
  process.stdout.write(`   ${Ye(' /\\___/\\ ')}\n`);
  process.stdout.write(`   ${Wh('(')} ${Ye('o')} ${Di('.')} ${Ye('o')} ${Wh(')')}\n`);
  process.stdout.write(`   ${Gh('(')} ${Wh('> ^ <')} ${Gh(')')}\n`);
  process.stdout.write('\n');
  process.stdout.write(`  ${Wh('Boz')}  ${Gh('\u00b7 AI Market Analyzer')}  ${Di('v' + BUILD_VERSION)}\n`);
  process.stdout.write(`  ${Di('\u2500'.repeat(37))}\n`);
  process.stdout.write(`  ${Gh('AI-powered \u00b7 Multi-timeframe \u00b7 Live data')}\n`);
  process.stdout.write('\n');
}

// ─── Token / Key setup ───────────────────────────────────────────────────────

function printTokenHelp(): void {
  process.stdout.write('\n');
  process.stdout.write(`  ${c.wrap(c.yellow, '!')}  ${c.wrap(c.white, 'GITHUB_TOKEN is not set.')}\n`);
  process.stdout.write(`  ${c.wrap(c.dim,    '   GitHub Models requires a free personal access token.')}\n\n`);
  process.stdout.write(`  ${c.wrap(c.ghost,  '   Get one here:')}\n`);
  process.stdout.write(`  ${c.wrap(c.cyan,   '   ' + GITHUB_TOKEN_URL)}\n\n`);
  process.stdout.write(`  ${c.wrap(c.ghost,  '   Then add it to your .env:')}\n`);
  process.stdout.write(`  ${c.wrap(c.dim,    '   GITHUB_TOKEN=ghp_your_token_here')}\n\n`);
}

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === 'win32'  ? `start "" "${url}"` :
      process.platform === 'darwin' ? `open "${url}"` :
                                      `xdg-open "${url}"`;
    execSync(cmd, { stdio: 'ignore' });
  } catch (err) {
    console.warn('openBrowser: failed to open URL', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Sanitize a secret value before writing it to .env.
 * Strips newlines, tabs, and non-printable ASCII characters that could
 * corrupt the file or inject extra key=value lines.
 */
function sanitizeEnvValue(value: string): string {
  return value
    .replace(/[\r\n\t]/g, '')      // strip newlines / tabs
    .replace(/[^\x20-\x7E]/g, '') // strip non-printable ASCII
    .trim();
}

function upsertEnvVar(key: string, value: string): void {
  const safe     = sanitizeEnvValue(value);
  const envPath  = path.resolve(process.cwd(), '.env');
  let   contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lineRe   = new RegExp('^' + key + '=.*$', 'm');
  const line     = `${key}=${safe}`;
  if (lineRe.test(contents)) {
    contents = contents.replace(lineRe, line);
  } else {
    contents = contents.trimEnd();
    contents = contents ? `${contents}\n${line}\n` : `${line}\n`;
  }
  fs.writeFileSync(envPath, contents, 'utf8');
}

async function promptForGitHubToken(): Promise<void> {
  process.stdout.write(`\n  ${c.wrap(c.yellow, '\u26a0  GITHUB_TOKEN is not set.')}\n`);
  process.stdout.write(`  Opening the GitHub token creation page in your browser\u2026\n`);
  process.stdout.write(`  ${c.wrap(c.dim, GITHUB_TOKEN_URL)}\n\n`);

  openBrowser(GITHUB_TOKEN_URL);

  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  let token = '';
  while (!token.trim()) {
    token = await askQuestion('  Paste your GitHub token here: ');
    if (!token.trim()) {
      process.stdout.write(`  ${c.wrap(c.red, 'Token cannot be empty \u2014 please try again.')}\n`);
    }
  }

  token = token.trim();
  upsertEnvVar('GITHUB_TOKEN', token);
  process.env.GITHUB_TOKEN = token;

  process.stdout.write(`\n  ${c.wrap(c.green, '\u2714 Token saved to .env')}\n\n`);
}

async function promptForNvidiaKey(): Promise<void> {
  process.stdout.write(`\n  ${c.wrap(c.yellow, '\u26a0  NVIDIA_API_KEY is not set.')}\n`);
  process.stdout.write(`  Opening the NVIDIA NIM API key page in your browser\u2026\n`);
  process.stdout.write(`  ${c.wrap(c.dim, NVIDIA_API_KEY_URL)}\n\n`);
  process.stdout.write(`  ${c.wrap(c.ghost, '  1. Sign in or create a free account')}\n`);
  process.stdout.write(`  ${c.wrap(c.ghost, '  2. Click your model \u2192 "Get API Key"')}\n`);
  process.stdout.write(`  ${c.wrap(c.ghost, '  3. Copy the key (starts with nvapi-)')}\n\n`);

  openBrowser(NVIDIA_API_KEY_URL);

  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  let key = '';
  while (!key.trim()) {
    key = await askQuestion('  Paste your NVIDIA API key here: ');
    if (!key.trim()) {
      process.stdout.write(`  ${c.wrap(c.red, 'Key cannot be empty \u2014 please try again.')}\n`);
    }
  }

  key = key.trim();
  upsertEnvVar('NVIDIA_API_KEY', key);
  process.env.NVIDIA_API_KEY = key;
  // nvidiaConfig.apiKey is a lazy getter on process.env, picks this up immediately

  process.stdout.write(`\n  ${c.wrap(c.green, '\u2714 Key saved to .env')}\n\n`);
}

// ─── Startup Wizard ───────────────────────────────────────────────────────────

async function runStartupWizard(): Promise<void> {
  const hasGithubToken = Boolean(githubConfig.token);
  const hasOfflineUrl  = Boolean(process.env.OFFLINE_AI_URL);
  const hasNvidiaKey   = Boolean(nvidiaConfig.apiKey);

  // ── Fast-path: skip picker when AI_PROVIDER is pre-set in .env ───────────
  const envProvider = (process.env.AI_PROVIDER || '').toLowerCase();
  if (envProvider === 'nvidia' || envProvider === 'github' || envProvider === 'offline') {
    const chosenProvider: AIProvider =
      envProvider === 'nvidia'  ? 'nvidia'  :
      envProvider === 'offline' ? 'offline' : 'github';

    if (chosenProvider === 'nvidia' && !hasNvidiaKey) {
      await promptForNvidiaKey();
      restoreRawMode();
    } else if (chosenProvider === 'github' && !hasGithubToken) {
      await promptForGitHubToken();
      restoreRawMode();
    } else if (chosenProvider === 'offline' && !hasOfflineUrl) {
      process.stdout.write(`\n  ${c.wrap(c.ghost, 'Ollama endpoint')}  ${c.wrap(c.ghost, '(session only, not saved)')}\n\n`);
      const url = await askQuestion(`  URL [http://localhost:11434]: `);
      restoreRawMode();
      config.setOfflineEndpoint(url || 'http://localhost:11434');
    }

    config.setAIProvider(chosenProvider);

    const providerColor =
      chosenProvider === 'nvidia'  ? c.cyan   :
      chosenProvider === 'offline' ? c.yellow : c.green;

    process.stdout.write(
      `  ${c.wrap(c.ghost, 'provider')}  ${c.wrap(providerColor, chosenProvider)}\n` +
      `  ${c.wrap(c.ghost, 'model   ')}  ${c.wrap(c.green, config.aiModel)}\n` +
      `  ${c.wrap(c.ghost, 'endpoint')}  ${c.wrap(c.dim, config.aiEndpoint)}\n\n`,
    );
    return;
  }

  // ── Interactive picker (no AI_PROVIDER in .env) ───────────────────────────
  process.stdout.write(
    `  ${c.wrap(c.ghost, 'AI provider')}  ` +
    `${c.wrap(c.ghost, 'left / right to select, Enter to confirm')}\n\n`,
  );

  const defaultProviderIdx = hasGithubToken ? 0 : hasNvidiaKey ? 2 : hasOfflineUrl ? 1 : 0;
  const providerIdx = await hPick(['Github', 'Ollama', 'NVIDIA'], defaultProviderIdx);

  const chosenProvider: AIProvider =
    providerIdx === 0 ? 'github' :
    providerIdx === 1 ? 'offline' :
                        'nvidia';

  const providerLabel =
    providerIdx === 0 ? 'github' :
    providerIdx === 1 ? 'ollama' :
                        'nvidia';

  process.stdout.write(`\n  provider  ${c.wrap(c.green, providerLabel)}\n\n`);

  // ── Step 2: provider-specific config ──────────────────────────────────────
  if (chosenProvider === 'github') {
    if (!githubConfig.token) {
      await promptForGitHubToken();
    }
    config.setAIProvider('github');

    const envModel   = process.env.GITHUB_AI_MODEL;
    const defaultIdx = envModel ? Math.max(0, GITHUB_MODELS.findIndex((m) => m.id === envModel)) : 0;

    process.stdout.write(
      `  ${c.wrap(c.ghost, 'Model')}  ` +
      `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
    );

    const modelIdx = await vPick(GITHUB_MODELS.map((m) => m.label), defaultIdx);
    githubConfig.model = GITHUB_MODELS[modelIdx].id;
    config.setAIProvider('github');
    process.env.AI_PROVIDER = 'github';
    upsertEnvVar('AI_PROVIDER', 'github');
    process.env.GITHUB_AI_MODEL = githubConfig.model;
    upsertEnvVar('GITHUB_AI_MODEL', githubConfig.model);

    process.stdout.write(`\n  model  ${c.wrap(c.green, GITHUB_MODELS[modelIdx].id)}\n\n`);

  } else if (chosenProvider === 'offline') {
    process.stdout.write(
      `  ${c.wrap(c.ghost, 'Ollama endpoint')}  ` +
      `${c.wrap(c.ghost, '(session only, not saved)')}\n\n`,
    );

    const url = await askQuestion(`  URL [http://localhost:11434]: `);
    restoreRawMode();
    const resolvedUrl = url || 'http://localhost:11434';
    config.setOfflineEndpoint(resolvedUrl);
    process.env.OFFLINE_AI_URL = resolvedUrl;
    upsertEnvVar('OFFLINE_AI_URL', resolvedUrl);
    config.setAIProvider('offline');
    process.env.AI_PROVIDER = 'offline';
    upsertEnvVar('AI_PROVIDER', 'offline');

    process.stdout.write(`\n  endpoint  ${c.wrap(c.green, resolvedUrl)}\n\n`);

  } else {
    // nvidia
    if (!nvidiaConfig.apiKey) {
      await promptForNvidiaKey();
    }
    config.setAIProvider('nvidia');

    const envModel   = process.env.NVIDIA_AI_MODEL;
    const defaultIdx = envModel ? Math.max(0, NVIDIA_MODELS.findIndex((m) => m.id === envModel)) : 0;

    process.stdout.write(
      `  ${c.wrap(c.ghost, 'Model')}  ` +
      `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
    );

    const modelIdx = await vPick(NVIDIA_MODELS.map((m) => m.label), defaultIdx);
    nvidiaConfig.model = NVIDIA_MODELS[modelIdx].id;
    config.setAIProvider('nvidia');
    process.env.AI_PROVIDER = 'nvidia';
    upsertEnvVar('AI_PROVIDER', 'nvidia');
    process.env.NVIDIA_AI_MODEL = nvidiaConfig.model;
    upsertEnvVar('NVIDIA_AI_MODEL', nvidiaConfig.model);

    process.stdout.write(`\n  model  ${c.wrap(c.green, NVIDIA_MODELS[modelIdx].id)}\n\n`);
  }
}

// ─── AutoComplete ─────────────────────────────────────────────────────────────

class AutoComplete {
  private readonly topLevel: string[];
  private readonly providers = ['github', 'offline', 'nvidia'];

  constructor(commands: Command[]) {
    this.topLevel = commands.map((cmd) => `/${cmd.name}`);
  }

  getSuggestion(input: string): string {
    if (!input) return '';
    if (input === '/') return 'help';

    const modelPrefix = '/model ';
    if (input.startsWith(modelPrefix)) {
      const typed = input.slice(modelPrefix.length);
      if (typed.includes(' ')) return '';
      const match = this.providers.find((p) => p.startsWith(typed) && p !== typed);
      return match ? match.slice(typed.length) : '';
    }

    const match = this.topLevel.find((cmd) => cmd.startsWith(input) && cmd !== input);
    return match ? match.slice(input.length) : '';
  }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class Renderer {
  private readonly PROMPT = `${c.ghost}boz${c.reset} ${c.dim}$${c.reset} `;

  renderPrompt(input: string, suggestion: string): void {
    const cursorBack = suggestion ? `\x1b[${suggestion.length}D` : '';
    process.stdout.write(
      '\r\x1b[K' +
        this.PROMPT +
        input +
        c.ghost + suggestion + c.reset +
        cursorBack,
    );
  }

  newLine(): void { process.stdout.write('\n'); }
  printInitialPrompt(): void { process.stdout.write(this.PROMPT); }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

export class CLI {
  private currentInput = '';
  private suggestion   = '';
  private isHandling   = false;

  private readonly renderer = new Renderer();
  private readonly commands: Command[] = [];
  private readonly ac: AutoComplete;

  constructor() {
    this.commands = this.buildCommands();
    this.ac = new AutoComplete(this.commands);
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  private buildCommands(): Command[] {
    return [
      {
        name: 'run',
        description: 'Run market analysis  (/run \u2192 pick mode)',
        handler: async () => {
          process.stdout.write('\n');

          // ── Token guard ───────────────────────────────────────────────
          if (config.aiProvider === 'github' && !githubConfig.token) {
            printTokenHelp();
            process.stdout.write(
              `  ${c.wrap(c.ghost, 'Switch to Ollama with')} ${c.wrap(c.white, '/model offline')}` +
              ` ${c.wrap(c.ghost, 'or add GITHUB_TOKEN to .env and restart.')}\n\n`,
            );
            return;
          }
          process.stdout.write(
            `  ${c.wrap(c.ghost, 'Mode')}  ` +
            `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
          );
          const modeIdx = await vPick(['AI Market Analyzer', 'News Intel Analyzer', 'News Intel Agent', 'Interactive Chat Agent']);

          if (modeIdx === 0) {
            process.stdout.write(`\n  mode  ${c.wrap(c.green, 'ai-market-analyzer')}\n\n`);

            process.stdout.write(
              `  ${c.wrap(c.ghost, 'Ticker')}  ` +
              `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
            );
            const chosenTicker = await promptForMarketTicker();
            if (!chosenTicker) {
              process.stdout.write(`\n  ${c.wrap(c.ghost, 'Run cancelled.')}\n\n`);
              return;
            }
            config.setTicker(chosenTicker);
            process.stdout.write(`\n  ticker  ${c.wrap(c.cyan, config.ticker)}\n\n`);

            process.stdout.write(
              `  ${c.wrap(c.ghost, 'Timeframe')}  ` +
              `${c.wrap(c.ghost, 'left / right to select, Enter to confirm')}\n\n`,
            );
            const tfIdx = await hPick(['Intraday  (2\u20136 h)', 'Long-term  (3\u201312 mo)']);
            process.stdout.write(
              `\n  timeframe  ${
                tfIdx === 0
                  ? c.wrap(c.green, 'intraday')
                  : c.wrap(c.cyan,  'long-term')
              }\n\n`,
            );

            if (tfIdx === 0) {
              await new IntradayAnalyzer().runAnalysis();
            } else {
              await new LongTermAnalyzer().runAnalysis();
            }
          } else if (modeIdx === 1) {
            process.stdout.write(`\n  mode  ${c.wrap(c.yellow, 'news-intel-analyzer')}\n\n`);
            await new NewsIntelAnalyzer().runAnalysis();
          } else if (modeIdx === 2) {
            process.stdout.write(`\n  mode  ${c.wrap(c.yellow, 'news-intel-agent')}\n`);
            process.stdout.write(`  ${c.wrap(c.yellow, '[EXPERIMENTAL - Still in Beta]')}\n\n`);
            await new NewsIntelAgent().runAnalysis();
          } else {
            process.stdout.write(`\n  mode  ${c.wrap(c.magenta, 'interactive-chat-agent')}\n\n`);
            await new InteractiveChatAgent().run();
          }
          process.stdout.write('\n');
        },
      },
      {
        name: 'model',
        description: 'View or switch AI provider  (/model [github|offline|nvidia])',
        handler: async (args) => {
          if (!args.length) {
            process.stdout.write('\n');
            this.printModelStatus();
            return;
          }

          const provider = args[0].toLowerCase() as AIProvider;

          if (provider === 'offline') {
            let url = args.slice(1).join(' ').trim();
            if (!url) {
              process.stdout.write('\n');
              url = await askQuestion('  OFFLINE_AI_URL: ');
              restoreRawMode();
            }
            if (!url) {
              process.stdout.write(`\n  ${c.wrap(c.red, 'URL required for offline mode.')}\n\n`);
              return;
            }
            config.setOfflineEndpoint(url);
            process.env.OFFLINE_AI_URL = url;
            upsertEnvVar('OFFLINE_AI_URL', url);

          } else if (provider === 'github') {
            if (args[1] === '--pick') {
              process.stdout.write(
                `\n  ${c.wrap(c.ghost, 'Model')}  ` +
                `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
              );
              const idx = await vPick(GITHUB_MODELS.map((m) => m.label));
              githubConfig.model = GITHUB_MODELS[idx].id;
              process.env.GITHUB_AI_MODEL = githubConfig.model;
              upsertEnvVar('GITHUB_AI_MODEL', githubConfig.model);
              process.stdout.write(`\n  model  ${c.wrap(c.green, GITHUB_MODELS[idx].id)}\n\n`);
            }

          } else if (provider === 'nvidia') {
            if (!nvidiaConfig.apiKey) {
              await promptForNvidiaKey();
              restoreRawMode();
            }
            if (args[1] === '--pick' || !args[1]) {
              process.stdout.write(
                `\n  ${c.wrap(c.ghost, 'Model')}  ` +
                `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
              );
              const idx = await vPick(NVIDIA_MODELS.map((m) => m.label));
              nvidiaConfig.model = NVIDIA_MODELS[idx].id;
              process.env.NVIDIA_AI_MODEL = nvidiaConfig.model;
              upsertEnvVar('NVIDIA_AI_MODEL', nvidiaConfig.model);
              process.stdout.write(`\n  model  ${c.wrap(c.green, NVIDIA_MODELS[idx].id)}\n\n`);
            }
          } else {
            process.stdout.write(
              `\n  Unknown provider: ${c.wrap(c.red, provider)}.` +
              ` Use ${c.wrap(c.white, 'github')}, ${c.wrap(c.white, 'offline')}, or ${c.wrap(c.white, 'nvidia')}.\n\n`,
            );
            return;
          }

          config.setAIProvider(provider);
          process.env.AI_PROVIDER = provider;
          upsertEnvVar('AI_PROVIDER', provider);
          process.stdout.write('\n');
          this.printModelStatus();
        },
      },
      {
        name: 'changemodel',
        description: 'Change the AI model for the current provider',
        handler: async (args) => {
          const provider = config.aiProvider;

          if (provider === 'offline') {
            let newModel = args.join(' ').trim();
            if (!newModel) {
              process.stdout.write('\n');
              newModel = await askQuestion(`  Enter Ollama model name (current: ${config.aiModel}): `);
              restoreRawMode();
            }
            if (!newModel) {
              process.stdout.write(`\n  ${c.wrap(c.red, 'Model name required.')}\n\n`);
              return;
            }
            config.setAIModel(newModel);
            process.env.OFFLINE_AI_MODEL = newModel;
            upsertEnvVar('OFFLINE_AI_MODEL', newModel);
            process.stdout.write(`\n  Model set to: ${c.wrap(c.green, config.aiModel)}\n\n`);
          } else if (provider === 'github') {
            process.stdout.write(
              `\n  ${c.wrap(c.ghost, 'Model')}  ` +
              `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
            );
            const idx = await vPick(GITHUB_MODELS.map((m) => m.label));
            const newModel = GITHUB_MODELS[idx].id;
            config.setAIModel(newModel);
            process.env.GITHUB_AI_MODEL = newModel;
            upsertEnvVar('GITHUB_AI_MODEL', newModel);
            process.stdout.write(`\n  Model set to: ${c.wrap(c.green, config.aiModel)}\n\n`);
          } else if (provider === 'nvidia') {
            process.stdout.write(
              `\n  ${c.wrap(c.ghost, 'Model')}  ` +
              `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
            );
            const idx = await vPick(NVIDIA_MODELS.map((m) => m.label));
            const newModel = NVIDIA_MODELS[idx].id;
            config.setAIModel(newModel);
            process.env.NVIDIA_AI_MODEL = newModel;
            upsertEnvVar('NVIDIA_AI_MODEL', newModel);
            process.stdout.write(`\n  Model set to: ${c.wrap(c.green, config.aiModel)}\n\n`);
          }
        },
      },
      {
        name: 'status',
        description: 'Show current provider and model',
        handler: async () => {
          process.stdout.write('\n');
          this.printModelStatus();
        },
      },
      {
        name: 'ticker',
        description: 'Set or view the target ticker  (/ticker [symbol])',
        handler: async (args) => {
          if (!args.length) {
            process.stdout.write(`\n  Current ticker: ${c.wrap(c.green, config.ticker)}\n\n`);
            return;
          }
          const t = args[0].toUpperCase();
          try {
            config.setTicker(t);
            process.stdout.write(`\n  Ticker set to: ${c.wrap(c.green, config.ticker)}\n\n`);
          } catch (e) {
            process.stdout.write(`\n  ${c.wrap(c.red, (e as Error).message)}\n\n`);
          }
        },
      },
      {
        name: 'risk',
        description: 'Override risk sentiment  (/risk [auto|on|off])',
        handler: async (args) => {
          if (!args.length) {
            process.stdout.write(`\n  Current risk mode: ${c.wrap(c.green, config.riskMode)}\n\n`);
            return;
          }
          const mode = args[0].toLowerCase();
          if (mode === 'auto' || mode === 'on' || mode === 'off') {
            config.setRiskMode(mode as 'auto' | 'on' | 'off');
            process.stdout.write(`\n  Risk mode set to: ${c.wrap(c.green, mode)}\n\n`);
          } else {
            process.stdout.write(`\n  Invalid mode: ${c.wrap(c.red, mode)}. Use auto, on, or off.\n\n`);
          }
        },
      },
      {
        name: 'help',
        description: 'Show available commands',
        handler: async () => {
          process.stdout.write('\n');
          this.printHelp();
        },
      },
      {
        name: 'version',
        description: 'Show Boz version',
        handler: async () => {
          process.stdout.write(
            `\n  ${c.wrap(c.white, 'Boz')}  ${c.wrap(c.ghost, 'v' + BUILD_VERSION)}\n\n`,
          );
        },
      },
      {
        name: 'exit',
        description: 'Exit Boz',
        handler: async () => {
          process.stdout.write('  Bye.\n');
          process.exit(0);
        },
      },
    ];
  }

  // ─── Display Helpers ───────────────────────────────────────────────────────

  private printModelStatus(): void {
    const providerColor =
      config.aiProvider === 'nvidia'  ? c.cyan  :
      config.aiProvider === 'offline' ? c.yellow :
                                        c.green;
    process.stdout.write(
      `  provider  ${c.wrap(providerColor, config.aiProvider)}\n` +
      `  model     ${c.wrap(c.green, config.aiModel)}\n` +
      `  endpoint  ${c.wrap(c.ghost, config.aiEndpoint)}\n` +
      `  ticker    ${c.wrap(c.cyan, config.ticker)}\n` +
      `  risk mode ${c.wrap(c.magenta, config.riskMode)}\n\n`,
    );
  }

  private printHelp(): void {
    const pad = Math.max(...this.commands.map((cmd) => cmd.name.length)) + 2;
    const lines = this.commands.map((cmd) => {
      const name = `/${cmd.name}`.padEnd(pad + 1);
      return `  ${c.wrap(c.white, name)}  ${c.wrap(c.ghost, cmd.description)}`;
    });
    process.stdout.write(lines.join('\n') + '\n\n');
    process.stdout.write(
      `  ${c.wrap(c.ghost, 'Tip:')} Tab autocompletes commands.\n` +
      `       ${c.wrap(c.white, '/model github --pick')} or ${c.wrap(c.white, '/model nvidia')} to change model mid-session.\n\n`,
    );
  }

  // ─── Raw Mode ─────────────────────────────────────────────────────────────

  private enterRawMode(): void {
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
    readline.emitKeypressEvents(process.stdin);
  }

  // ─── Line Handling ─────────────────────────────────────────────────────────

  private async handleLine(): Promise<void> {
    if (this.isHandling) return;
    this.isHandling = true;

    const raw = this.currentInput.trim();
    this.currentInput = '';
    this.suggestion   = '';
    this.renderer.newLine();

    if (!raw) {
      this.renderer.renderPrompt('', '');
      this.isHandling = false;
      return;
    }

    const [rawCmd, ...args] = raw.split(/\s+/);
    const name = rawCmd.replace(/^\//, '');
    const cmd  = this.commands.find((cmd) => cmd.name === name);

    try {
      if (cmd) {
        await cmd.handler(args);
      } else {
        process.stdout.write(
          `  Unknown command: ${c.wrap(c.red, rawCmd)}.` +
          ` Type ${c.wrap(c.white, '/help')} for available commands.\n\n`,
        );
      }
    } catch (err) {
      process.stdout.write(
        `  ${c.wrap(c.red, 'Error:')} ${err instanceof Error ? err.message : String(err)}\n\n`,
      );
    } finally {
      this.enterRawMode();
      this.renderer.renderPrompt('', '');
      this.isHandling = false;
    }
  }

  // ─── Keypress ─────────────────────────────────────────────────────────────

  private handleKeypress(_str: unknown, key: KeypressEvent): void {
    if (!key) return;

    if (key.ctrl && key.name === 'c') {
      process.stdout.write('\n  Bye.\n');
      process.exit(0);
    }

    if (this.isHandling) return;

    switch (key.name) {
      case 'return':
      case 'enter':
        void this.handleLine();
        break;

      case 'tab':
        if (this.suggestion) {
          this.currentInput += this.suggestion;
          this.suggestion = '';
          this.renderer.renderPrompt(this.currentInput, '');
        }
        break;

      case 'backspace':
        if (this.currentInput.length > 0) {
          this.currentInput = this.currentInput.slice(0, -1);
          this.suggestion   = this.ac.getSuggestion(this.currentInput);
          this.renderer.renderPrompt(this.currentInput, this.suggestion);
        }
        break;

      default:
        if (key.sequence && !key.ctrl && !key.meta && key.sequence.length > 0) {
          // Allow pasting longer strings
          const isPrintable = /^[\x20-\x7E]*$/.test(key.sequence);
          if (isPrintable) {
            this.currentInput += key.sequence;
            this.suggestion   = this.ac.getSuggestion(this.currentInput);
            this.renderer.renderPrompt(this.currentInput, this.suggestion);
          }
        }
    }
  }

  // ─── Entry Point ───────────────────────────────────────────────────────────

  public async run(): Promise<void> {
    printMascot();
    await runStartupWizard();

    readline.emitKeypressEvents(process.stdin);
    this.enterRawMode();
    this.renderer.printInitialPrompt();

    process.stdin.on('keypress', (str, key) =>
      this.handleKeypress(str, key as KeypressEvent),
    );
  }
}
