<p align="center">
  <img src="src/img/logo.png" alt="BOZ logo" width="140" />
</p>

<p align="center">
  <strong>Behavioral Outlook Zone</strong><br/>
  AI-powered market analysis engine
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript&logoColor=white"/>
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat&logo=nodedotjs&logoColor=white"/>
  </a>
  <a href="https://opensource.org/licenses/ISC">
    <img src="https://img.shields.io/badge/License-ISC-1f6feb?style=flat"/>
  </a>
  <a href="https://github.com/AlGhozaliRamadhan">
    <img src="https://img.shields.io/badge/Author-AGR-111111?style=flat"/>
  </a>
  <img src="https://img.shields.io/badge/version-1.5.7-brightgreen?style=flat"/>
</p>

---

## What is BOZ?

**BOZ (Behavioral Outlook Zone)** is an open-source, terminal-native AI market analysis engine. It fuses real-time price data, technical indicators, multi-timeframe confluence, macro context, news, and crowd sentiment into structured, actionable intelligence complete with entry, target, stop, and risk/reward.

Four analysis modes are available, selected interactively at runtime:

| Mode | Horizon | Focus |
|---|---|---|
| **Market Intraday** | 2–6 hours | MTF confluence, momentum, volatility (searchable ticker/asset) |
| **Market Long-term** | 3–12 months | SMA structure, 52-week context, trend integrity (searchable ticker/asset) |
| **News Intel Analyzer** | Cross-asset | Multi-source news aggregation, cross-asset opportunity detection |
| **News Intel Agent** *(Experimental)* | Cross-asset | Autonomous ReAct agent self-directed multi-step research with tool orchestration, internal reflection, and opportunity emission |

Three AI providers are supported, selectable interactively at startup or switched mid-session:

| Provider | Backend | Notes |
|---|---|---|
| **GitHub Models** | OpenAI, DeepSeek, Meta, Microsoft | Free tier with GitHub token. Best for light analysis. |
| **NVIDIA NIM** | Nemotron 120B, DeepSeek V4, Qwen3.5, GPT-OSS 120B | Recommended for the News Intel Agent larger context, higher rate limits |
| **Ollama (Offline)** | Any Ollama-compatible endpoint | Local, no API key needed |

---

### Reflection Protocol

After every tool result, the agent reflects using a structured four-part format before deciding what to do next:

```
RECEIVED: what the data actually showed
EXPECTED: was this anticipated, and why
CHANGES:  how this updates the current thesis
NEXT:     what specific question this raises
```

### Opportunity Emission Standards

Every emitted opportunity must include a **Conviction Level**:
- **HIGH**: 3+ independent signals align. Action allowed: BUY / SELL.
- **MEDIUM**: 2 signals align. Action allowed: BUY / SELL.
- **SPECULATIVE**: Technical + macro align but confirmation missing (e.g. waiting on a catalyst). Confidence 40-55. WATCH preferred, but still emitted for transparency.

| Confidence | Requirement | Action allowed |
|---|---|---|
| > 80% | 3 independent confirming signals + Live price fetched | BUY / SELL |
| 65–80% | 2 signals | BUY / SELL |
| 50–65% | 1 signal | WATCH only |
| < 50% | — | Skip |

Every emitted opportunity includes: asset, asset type, action, conviction, confidence, reasoning, entry range, target range, stop loss, invalidation condition, risks, late-signal flag, and **exact tool sources**.

### Session Memory & Retrospective

The agent now remembers its past sessions. At the start of a new run, it reads the previous `session.log.json` and loads a **Retrospective Context**. Before making new calls, it checks its past calls (e.g. "BUY BTC @ 85% conviction"), fetches the live price, and scores itself ("AGED WELL" or "MISS") to continually calibrate its confidence.

### Resilience

- **Retry on 429 / 5xx:** every AI call is wrapped in `callAIWithRetry` up to 3 attempts with linear backoff (5 s → 10 s → 15 s). Retries also cover network-level errors (`ECONNRESET`, `ETIMEDOUT`).
- **Partial state on crash:** if the loop exits due to an unrecoverable error, `synthesiseFinish()` runs automatically so whatever the agent had accumulated is always rendered never a blank output.
- **Soft nudge:** at 15 minutes the agent is asked to wrap up. Hard cap is 20 minutes / 80 iterations.
- **Meta-summary fallback:** if the post-session AI debrief call fails, the inline `marketSummary`, `riskWarnings`, and `contrarian` signals are rendered instead.

---

## Architecture

```mermaid
flowchart TD
    YF[Yahoo Finance] --> CD[Candles]
    CD --> IND[Indicators\nRSI · MACD · BB · ATR · OBV]
    IND --> MS[Market Summary]
    IND --> MTF[MTF Bias\n1h · 4h · daily]
    IND --> STR[Market Structure\nHH·HL / LH·LL]
    IND --> VPC[Volume-Price\nCorrelation]
    IND --> FIB[Fibonacci\nLevels]

    MAC[Macro\nSPY · QQQ] --> AI
    NEWS[News\nYahoo Headlines] --> AI
    SENT[Sentiment\nFear & Greed · StockTwits] --> AI

    MS --> AI[AI Synthesis\nGitHub Models / NVIDIA NIM / Ollama]
    MTF --> AI
    STR --> AI
    VPC --> AI
    FIB --> AI

    AI --> VB[Verdict Box\nDirection · Confidence · R/R]
    AI --> BD[Full Breakdown\n15+ sections]

    subgraph NewsIntelAgent[News Intel Agent — Autonomous ReAct Loop]
      NF[RSS · CoinGecko · CryptoCompare\nAlpha Vantage · Finnhub · FRED\nYahoo Finance Live Prices] --> NFS[NewsFetchService Singleton\nDisk-cached · TTL-aware]
      NFS --> BA[BaseAgent\ncallAIWithRetry · runLoop · synthesiseFinish]
      BA --> NIA[NewsIntelAgent\n13 tools · reflection protocol]
      NIA --> OPP[Opportunities\nentry · target · stop · confidence]
      NIA --> REG[Regime · Summary\nContrarian · Risk Warnings]
    end
```

---

## Install

```bash
git clone https://github.com/AlGhozaliRamadhan/boz.git
cd boz
npm install
npm run dev
```

At startup, select your AI provider and model. Then type `/run` to begin.

> **Recommendation:** Use **NVIDIA NIM** for the News Intel Agent. GitHub Models has aggressive rate limits that can interrupt multi-step agentic sessions. NVIDIA NIM handles the longer context window and sustained tool-calling loop without throttling.

---

## Configuration

Create a `.env` file in the project root:

```env
# AI Provider: github (default), nvidia, or offline
AI_PROVIDER=nvidia

# GitHub Models
GITHUB_TOKEN=ghp_your_token_here
GITHUB_AI_MODEL=openai/gpt-4o
GITHUB_AI_ENDPOINT=https://models.github.ai/inference

# NVIDIA NIM (recommended for News Intel Agent)
NVIDIA_API_KEY=nvapi-your_key_here
NVIDIA_AI_MODEL=nvidia/nemotron-3-super-120b-a12b
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# Offline (Ollama-compatible)
OFFLINE_AI_URL=http://localhost:11434
OFFLINE_AI_MODEL=qwen3-14b-t4

# News Intel optional enrichment
ALPHA_VANTAGE_API_KEY=your_key_here
FINNHUB_API_KEY=your_key_here
FRED_API_KEY=your_key_here
```

**Provider notes:**
- Defaults to `github` if `AI_PROVIDER` is not set
- If `AI_PROVIDER` is set in `.env`, the startup wizard skips the interactive picker and applies it directly
- Missing `GITHUB_TOKEN` triggers an interactive setup flow that opens the GitHub token page in your browser and saves the token to `.env`
- Missing `NVIDIA_API_KEY` triggers the same flow pointing to build.nvidia.com
- Offline URL can be entered interactively at startup or via `/model offline <url>` — it is session-only and never written to `.env`

---

## CLI Reference

| Command | Description |
|---|---|
| `/run` | Pick analysis mode and execute |
| `/model` | Show current provider, model, and endpoint |
| `/model github` | Switch to GitHub Models |
| `/model github --pick` | Select GitHub model interactively |
| `/model nvidia` | Switch to NVIDIA NIM and pick model interactively |
| `/model offline <url>` | Switch to Ollama-compatible endpoint (session only) |
| `/status` | Show current provider, model, and endpoint |
| `/version` | Show Boz version |
| `/help` | List all commands |
| `/exit` | Exit Boz |

Tab autocompletes all commands. Left/right arrows navigate the mode picker on `/run`. Up/down arrows navigate model pickers.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run in development mode (tsx, no compile step) |
| `npm run build` | Compile TypeScript to `dist/` and run `npm link` |
| `npm run start` | Run compiled output from `dist/` |
| `npm test` | Run test suite (Vitest) |
| `npm run coverage` | Run tests with coverage report |
| `npm run ping` | Run the provider ping utility |

---

## Contributing

Contributions are welcome.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit with clear messages
4. Open a PR describing what changed and why

Please keep PRs focused. See `docs/` for per-version changelogs.

---

## Security Notes

- Never commit `.env` or any file containing API keys
- The `.gitignore` already excludes `.env` verify before pushing
- Be mindful of API rate limits on GitHub Models and NVIDIA NIM free tiers the News Intel Agent makes sustained multi-step calls
- Offline URL entered interactively is session-only and is never written to `.env`
- All AI outputs are advisory validate before acting on them

---

## Disclaimer

BOZ is a research and educational tool. It does not constitute financial advice.
All trading decisions are your sole responsibility.
Past analysis results do not guarantee future accuracy.
