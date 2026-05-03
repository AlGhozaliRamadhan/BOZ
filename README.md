# BOZ

AI-powered intraday market analyzer built with TypeScript.

BOZ (Behavioral Outlook Zone) combines market data, technical indicators, macro context, news, and crowd sentiment into structured AI analysis. It currently runs an intraday NVDA-focused pipeline and supports both GitHub Models and offline Ollama-compatible inference.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-ISC-1f6feb?style=flat)](https://opensource.org/licenses/ISC)
[![Author](https://img.shields.io/badge/Author-AGR-111111?style=flat)](https://github.com/AlGhozaliRamadhan)

## Overview

Boz is designed for short-horizon market decision support. The engine aggregates:

- Price and volume data from Yahoo Finance
- Technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV)
- Crowd sentiment (Fear and Greed + StockTwits)
- Macro context from benchmark ETFs
- AI synthesis into a structured prediction format

The current production flow is intraday and ticker-specific (NVDA), while project direction is evolving toward broader market coverage.

## Key Features

- Intraday analysis workflow (next 2-6 hour context)
- Multi-source signal fusion
- AI provider switching (GitHub Models or offline)
- Model fallback chain for resiliency
- Structured output with prediction, confidence, target, and stop
- Modular codebase for extension

## Quick Start

```bash
git clone https://github.com/AlGhozaliRamadhan/boz.git
cd boz
npm install
npm run dev
```

## Configuration

Create a .env file in the repository root:

```env
# Provider: github (default) or offline
AI_PROVIDER=github

# GitHub Models
GITHUB_TOKEN=ghp_your_token_here
GITHUB_AI_MODEL=openai/gpt-4o-mini
GITHUB_AI_ENDPOINT=https://models.github.ai/inference

# Offline (Ollama-compatible)
OFFLINE_AI_URL=http://localhost:11434
OFFLINE_AI_MODEL=qwen3-14b-t4
```

Notes:

- If AI_PROVIDER is not set, Boz defaults to github.
- If GITHUB_TOKEN is missing in github mode, AI analysis cannot run.
- Offline mode requires a reachable Ollama-compatible endpoint.

## CLI Commands

- /run: execute intraday NVDA analysis
- /model [github|offline] [url]: switch provider
- /model github --pick: choose model interactively
- /status: show active provider/model/endpoint
- /help: show command list
- /exit: terminate session

## Scripts

| Command | Description |
|---|---|
| npm run dev | Run with tsx in development |
| npm run build | Compile TypeScript to dist |
| npm run start | Run compiled build |
| npm run test | Placeholder test script |

## Roadmap

- Generalize runtime from NVDA-only to multi-ticker input
- Add deterministic tests for signal and parser logic
- Improve API-level output options (JSON/export)
- Expand documentation for deployment and monitoring

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a branch for your change.
3. Commit with a clear message.
4. Open a pull request with context and impact.

## Security and Data Notes

- Never commit .env or secret tokens.
- Review third-party API reliability and rate limits before production usage.
- Validate AI-generated trade suggestions against your own risk rules.

## Disclaimer

Boz is an educational and research tool. It is not financial advice. All trading and investment decisions remain your responsibility.
