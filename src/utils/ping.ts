#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ override: true });

const c = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  ghost:  '\x1b[90m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  white:  '\x1b[97m',
  cyan:   '\x1b[36m',
};
const clr = (color: string, text: string) => `${color}${text}${c.reset}`;

const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;

function startSpinner(label: string): void {
  spinnerFrame = 0;
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r  ${clr(c.cyan, FRAMES[spinnerFrame % FRAMES.length])}  ${clr(c.ghost, label)}`);
    spinnerFrame++;
  }, 80);
}

function stopSpinner(): void {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
  process.stdout.write('\r\x1b[K');
}

async function main(): Promise<void> {
  const apiKey = (process.env.NVIDIA_API_KEY || '').trim();
  const model  = (process.env.NVIDIA_AI_MODEL || 'deepseek-ai/deepseek-v4-pro').trim();
  const base   = (process.env.NVIDIA_BASE_URL  || 'https://integrate.api.nvidia.com/v1').trim();

  process.stdout.write('\n');
  process.stdout.write(`  ${clr(c.white, 'NVIDIA NIM')}  ${clr(c.ghost, '· live reply test')}\n`);
  process.stdout.write(`  ${clr(c.dim, '─'.repeat(38))}\n`);
  process.stdout.write(`  ${clr(c.ghost, 'model   ')}  ${clr(c.white, model)}\n`);
  process.stdout.write(`  ${clr(c.ghost, 'endpoint')}  ${clr(c.dim, base)}\n\n`);

  if (!apiKey) {
    process.stdout.write(`  ${clr(c.red, '✘')}  NVIDIA_API_KEY not set in .env\n\n`);
    process.exit(1);
  }

  const question = 'What is 1 + 1? Reply in one short sentence.';
  process.stdout.write(`  ${clr(c.ghost, 'asking')}  "${question}"\n\n`);

  startSpinner('Waiting for reply…');
  const start = Date.now();

  // Step 1 — auth check: hit /models first, fast and always returns immediately
  try {
    const modelsRes = await fetch(`${base}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(8000),
    });
    stopSpinner();
    if (modelsRes.status === 401 || modelsRes.status === 403) {
      process.stdout.write(`  ${clr(c.red, '✘')}  Auth failed (${modelsRes.status}) — your NVIDIA_API_KEY is invalid or expired\n\n`);
      process.exit(1);
    }
    startSpinner('Auth OK — waiting for model reply…');
  } catch {
    stopSpinner();
    process.stdout.write(`  ${clr(c.red, '✘')}  Cannot reach ${base} — check your internet connection\n\n`);
    process.exit(1);
  }

  // Step 2 — real inference call
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages:             [{ role: 'user', content: question }],
        max_tokens:           64,
        temperature:          1,
        top_p:                0.95,
        stream:               true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      stopSpinner();
      const body = await res.text().catch(() => '');
      const note =
        res.status === 401 || res.status === 403 ? 'Auth failed — check your NVIDIA_API_KEY' :
        res.status === 404                        ? `Model not found: ${model}` :
        res.status === 429                        ? 'Rate limited — wait a moment and retry' :
        res.status === 500 || res.status === 503  ? 'NVIDIA server error — their side, not yours' :
                                                    body.slice(0, 120);
      process.stdout.write(`  ${clr(c.red, '✘')}  HTTP ${res.status}\n`);
      process.stdout.write(`     ${clr(c.yellow, note)}\n\n`);
      process.exit(1);
    }

    // Stream the full reply and print it token by token
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullReply  = '';
    let firstToken = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const line of decoder.decode(value).split('\n')) {
        const trimmed = line.replace(/^data: /, '').trim();
        if (!trimmed || trimmed === '[DONE]') continue;
        try {
          const parsed  = JSON.parse(trimmed);
          const token   = parsed?.choices?.[0]?.delta?.content ?? '';
          if (!token) continue;

          if (firstToken) {
            stopSpinner();
            const ttft = Date.now() - start;
            process.stdout.write(`  ${clr(c.green, '✔')}  Reply  ${clr(c.dim, `(first token: ${ttft}ms)`)}\n\n`);
            process.stdout.write(`  ${clr(c.cyan, '┃')}  `);
            firstToken = false;
          }

          process.stdout.write(clr(c.white, token));
          fullReply += token;
        } catch { /* skip malformed SSE lines */ }
      }
    }

    const totalMs = Date.now() - start;
    process.stdout.write(`\n\n  ${clr(c.dim, `total: ${totalMs}ms · ${fullReply.length} chars`)}\n`);
    process.stdout.write(`  ${clr(c.green, '✔')}  NVIDIA NIM is working.\n\n`);

  } catch (err: unknown) {
    stopSpinner();
    const msg  = err instanceof Error ? err.message : String(err);
    const note = msg.includes('abort') || msg.includes('timeout') || msg.includes('TimeoutError')
      ? 'Model is not responding after 30s.\n     This usually means NVIDIA\'s servers are overloaded or the model is unavailable.\n     Check status at: https://status.build.nvidia.com'
      : msg;
    process.stdout.write(`  ${clr(c.red, '✘')}  ${clr(c.yellow, note)}\n\n`);
    process.exit(1);
  }
}

main();
