import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { NVDAIntradayAnalyzer } from '../analyzers/nvda.intraday.analyzer.js';
import { NVDALongTermAnalyzer } from '../analyzers/nvda.longterm.analyzer.js';
import { config, type AIProvider } from '../config/config.js';
import { githubConfig, GITHUB_TOKEN_URL } from '../config/github.config.js';

// ─── Version ──────────────────────────────────────────────────────────────────

const _require = createRequire(import.meta.url);
const PKG_VERSION: string = (_require('../../package.json') as { version: string }).version;

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
  wrap: (color: string, text: string) => `${color}${text}\x1b[0m`,
} as const;

// ─── GitHub Models Registry ───────────────────────────────────────────────────

const GITHUB_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-4o',                      label: 'GPT-4o              (OpenAI, recommended)' },
  { id: 'openai/gpt-4o-mini',                 label: 'GPT-4o mini         (OpenAI, fast & generous quota)' },
  { id: 'openai/gpt-5',                        label: 'GPT-5               (OpenAI, most capable)' },
  { id: 'deepseek/DeepSeek-R1-0528',           label: 'DeepSeek R1-0528    (reasoning model)' },
  { id: 'deepseek/DeepSeek-V3-0324',           label: 'DeepSeek V3-0324    (fast, balanced)' },
  { id: 'meta/Llama-4-Scout-17B-16E-Instruct', label: 'Llama 4 Scout 17B  (Meta, free tier)' },
  { id: 'microsoft/Phi-4',                     label: 'Phi-4               (Microsoft, lightweight)' },
];

// ─── Horizontal picker  (left / right arrow) ──────────────────────────────────

function renderHPicker(options: string[], selected: number): void {
  const parts = options.map((opt, i) =>
    i === selected
      ? `${c.white}> ${opt}${c.reset}`
      : `${c.ghost}  ${opt}${c.reset}`,
  );
  process.stdout.write(`\r\x1b[K  ${parts.join('     ')}`);
}

function hPick(options: string[], defaultIdx = 0): Promise<number> {
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

// ─── Vertical picker  (up / down arrow) ───────────────────────────────────────

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

function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function restoreRawMode(): void {
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
  readline.emitKeypressEvents(process.stdin);
}

// ─── Mascot ───────────────────────────────────────────────────────────────────

function printMascot(): void {
  const W  = c.wrap;
  const Wh = (s: string) => W(c.white,  s);
  const Gh = (s: string) => W(c.ghost,  s);
  const Di = (s: string) => W(c.dim,    s);
  const Ye = (s: string) => W(c.yellow, s);

  process.stdout.write('\n');
  process.stdout.write(`   ${Wh('/\\_____/\\')}\n`);
  process.stdout.write(`   ${Wh('(')} ${Ye('◉')}   ${Ye('◉')} ${Wh(')')}\n`);
  process.stdout.write(`    ${Wh('(')} ${Wh('=ω=')} ${Wh(')')}\n`);
  process.stdout.write(`    ${Wh(')')}     ${Wh('(')}\n`);
  process.stdout.write(`   ${Wh('(_______)')}\n`);
  process.stdout.write(`\n  ${Wh('Boz')}  ${Gh('· NVDA Intraday Analyzer')}  ${Di('v' + PKG_VERSION)}\n`);
  process.stdout.write(`  ${Di('─'.repeat(37))}\n`);
  process.stdout.write(`  ${Gh('AI-powered · Multi-timeframe · Live data')}\n`);
  process.stdout.write('\n');
}

// ─── Token setup ─────────────────────────────────────────────────────────────

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

function upsertEnvVar(key: string, value: string): void {
  const envPath = path.resolve(process.cwd(), '.env');
  let contents  = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lineRe  = new RegExp(`^${key}=.*$`, 'm');
  const line    = `${key}=${value}`;
  if (lineRe.test(contents)) {
    contents = contents.replace(lineRe, line);
  } else {
    contents = contents.trimEnd();
    contents = contents ? `${contents}\n${line}\n` : `${line}\n`;
  }
  fs.writeFileSync(envPath, contents, 'utf8');
}

async function promptForGitHubToken(): Promise<void> {
  process.stdout.write(`\n  ${c.wrap(c.yellow, '⚠  GITHUB_TOKEN is not set.')}\n`);
  process.stdout.write(`  Opening the GitHub token creation page in your browser…\n`);
  process.stdout.write(`  ${c.wrap(c.dim, GITHUB_TOKEN_URL)}\n\n`);

  openBrowser(GITHUB_TOKEN_URL);

  // Must be out of raw mode for readline to work
  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  let token = '';
  while (!token.trim()) {
    token = await askQuestion('  Paste your GitHub token here: ');
    if (!token.trim()) {
      process.stdout.write(`  ${c.wrap(c.red, 'Token cannot be empty — please try again.')}\n`);
    }
  }

  token = token.trim();
  upsertEnvVar('GITHUB_TOKEN', token);
  process.env.GITHUB_TOKEN = token;
  // githubConfig.token is a lazy getter on process.env, so it picks this up immediately

  process.stdout.write(`\n  ${c.wrap(c.green, '✔ Token saved to .env')}\n\n`);
}

// ─── Startup Wizard ───────────────────────────────────────────────────────────

async function runStartupWizard(): Promise<void> {
  // Re-read token each time so a stale empty .env doesn't fool the check
  const hasGithubToken = Boolean(githubConfig.token);
  const hasOfflineUrl  = Boolean(process.env.OFFLINE_AI_URL);

  // ── Step 1: provider ──────────────────────────────────────────────────────
  process.stdout.write(
    `  ${c.wrap(c.ghost, 'AI provider')}  ` +
    `${c.wrap(c.ghost, 'left / right to select, Enter to confirm')}\n\n`,
  );

  const defaultProviderIdx = hasGithubToken || !hasOfflineUrl ? 0 : 1;
  const providerIdx = await hPick(['Github', 'Ollama'], defaultProviderIdx);
  const chosenProvider: AIProvider = providerIdx === 0 ? 'github' : 'offline';

  process.stdout.write(
    `\n  provider  ${c.wrap(c.green, providerIdx === 0 ? 'github' : 'ollama')}\n\n`,
  );

  // ── Step 2: provider-specific config ──────────────────────────────────────
  if (chosenProvider === 'github') {
    // Re-read token here too — may have been set after dotenv loaded
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

    process.stdout.write(`\n  model  ${c.wrap(c.green, GITHUB_MODELS[modelIdx].id)}\n\n`);

  } else {
    process.stdout.write(
      `  ${c.wrap(c.ghost, 'Ollama endpoint')}  ` +
      `${c.wrap(c.ghost, '(session only, not saved)')}\n\n`,
    );

    const url = await askQuestion(`  URL [http://localhost:11434]: `);
    restoreRawMode();
    const resolvedUrl = url || 'http://localhost:11434';
    config.setOfflineEndpoint(resolvedUrl);
    config.setAIProvider('offline');

    process.stdout.write(`\n  endpoint  ${c.wrap(c.green, resolvedUrl)}\n\n`);
  }
}

// ─── AutoComplete ─────────────────────────────────────────────────────────────

class AutoComplete {
  private readonly topLevel: string[];
  private readonly providers = ['github', 'offline'];

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
  private isPrompting  = false;
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
        description: 'Run the NVDA market analysis  (/run → pick mode)',
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
            `${c.wrap(c.ghost, 'left / right to select, Enter to confirm')}\n\n`,
          );
          const modeIdx = await hPick(['Intraday  (2–6 h)', 'Long-term  (3–12 mo)']);
          process.stdout.write(
            `\n  mode  ${
              modeIdx === 0
                ? c.wrap(c.green, 'intraday')
                : c.wrap(c.cyan,  'long-term')
            }\n`,
          );
          process.stdout.write('\n');
          if (modeIdx === 0) {
            await new NVDAIntradayAnalyzer().runAnalysis();
          } else {
            await new NVDALongTermAnalyzer().runAnalysis();
          }
          process.stdout.write('\n');
        },
      },
      {
        name: 'model',
        description: 'View or switch AI provider  (/model [github|offline] [url])',
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

          } else if (provider === 'github') {
            if (args[1] === '--pick') {
              process.stdout.write(
                `\n  ${c.wrap(c.ghost, 'Model')}  ` +
                `${c.wrap(c.ghost, 'up / down to select, Enter to confirm')}\n\n`,
              );
              const idx = await vPick(GITHUB_MODELS.map((m) => m.label));
              githubConfig.model = GITHUB_MODELS[idx].id;
              process.stdout.write(`\n  model  ${c.wrap(c.green, GITHUB_MODELS[idx].id)}\n\n`);
            }

          } else {
            process.stdout.write(
              `\n  Unknown provider: ${c.wrap(c.red, provider)}.` +
              ` Use ${c.wrap(c.white, 'github')} or ${c.wrap(c.white, 'offline')}.\n\n`,
            );
            return;
          }

          config.setAIProvider(provider);
          process.stdout.write('\n');
          this.printModelStatus();
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
            `\n  ${c.wrap(c.white, 'Boz')}  ${c.wrap(c.ghost, 'v' + PKG_VERSION)}\n\n`,
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
    process.stdout.write(
      `  provider  ${c.wrap(c.green, config.aiProvider)}\n` +
      `  model     ${c.wrap(c.green, config.aiModel)}\n` +
      `  endpoint  ${c.wrap(c.ghost, config.aiEndpoint)}\n\n`,
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
      `       ${c.wrap(c.white, '/model github --pick')} to change model mid-session.\n\n`,
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

    if (cmd) {
      await cmd.handler(args);
    } else {
      process.stdout.write(
        `  Unknown command: ${c.wrap(c.red, rawCmd)}.` +
        ` Type ${c.wrap(c.white, '/help')} for available commands.\n\n`,
      );
    }

    this.renderer.renderPrompt('', '');
    this.isHandling = false;
  }

  // ─── Keypress ─────────────────────────────────────────────────────────────

  private handleKeypress(_str: unknown, key: KeypressEvent): void {
    if (!key || this.isPrompting) return;

    if (key.ctrl && key.name === 'c') {
      process.stdout.write('\n  Bye.\n');
      process.exit(0);
    }

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
        if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
          this.currentInput += key.sequence;
          this.suggestion   = this.ac.getSuggestion(this.currentInput);
          this.renderer.renderPrompt(this.currentInput, this.suggestion);
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
