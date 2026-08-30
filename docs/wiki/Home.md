# Welcome to the BOZ (Behavioral Outlook Zone) Wiki

**Behavioral Outlook Zone (BOZ)** is an open-source, web-first AI market intelligence dashboard and multi-agent analytics engine. It transforms raw market data, multi-timeframe technical indicators, macroeconomic regimes, breaking news, and social crowd sentiment into actionable, risk-aware trading theses.

---

## 🧭 Wiki Directory

| Section | Description |
|---|---|
| **[Architecture & Core Engine](Architecture-&-Core-Engine)** | Overview of Next.js 16 standalone design, CLI launcher, runtime data caches, and async pipelines. |
| **[Omni-Agent & AI Workflows](Omni-Agent-&-AI-Workflows)** | Deep dive into multi-agent conversational research loops, reflection, tool calling, and AI backend support (GitHub Models, NVIDIA NIM, Ollama, OpenAI). |
| **[Technical Analysis & Market Regimes](Technical-Analysis-&-Market-Regimes)** | Multi-timeframe indicator formulas (RSI, MACD, Bollinger, ATR, OBV, Fibonacci), structural HH/HL detection, and regime categorization. |
| **[Macro & Crowd Sentiment Intelligence](Macro-&-Crowd-Sentiment-Intelligence)** | Fear & Greed index, StockTwits & Reddit normalization, RSS news ingest, and macro drivers (DXY, 10Y Yield, BTC.D). |
| **[IDX Equities & Crypto Specialization](IDX-Equities-&-Crypto-Specialization)** | Indonesian stock exchange (IDX/LQ45) scanner and 24/7 cryptocurrency intelligence & symbol normalization. |
| **[Risk Management & Trade Planning](Risk-Management-&-Trade-Planning)** | Systematic trade plan generator: Conviction rating, Entry, Take-Profit targets, ATR-based Stop Loss, Risk-to-Reward Ratio (RRR), and invalidation criteria. |
| **[Configuration & Environment Variables](Configuration-&-Environment-Variables)** | Detailed breakdown of all environment variables, provider endpoints, port configurations, and runtime flags. |
| **[Deployment & Production Guide](Deployment-&-Production-Guide)** | Installation via global npm, zero-install NPX, Docker Compose, and standalone cloud deployment. |

---

## ⚡ High-Level Analysis Flow

`mermaid
flowchart LR
    subgraph Data Layer
        M[Market Data<br/>Yahoo / Crypto / IDX]
        N[News Feeds &<br/>RSS Streams]
        S[Social Sentiment<br/>Reddit / StockTwits / Fear&Greed]
        Macro[Macro Drivers<br/>DXY / 10Y / BTC.D]
    end

    subgraph Processing Engine
        T[Technicals Engine<br/>RSI, MACD, BB, ATR, Fibo]
        Sent[Sentiment Normalizer &<br/>Volume Anomaly Detector]
        Agent[Omni-Agent Research Loop<br/>Tools & Multi-Perspective Synthesis]
    end

    subgraph AI Backends
        AI[GitHub Models / NVIDIA NIM /<br/>Ollama / OpenAI]
    end

    subgraph User Experience
        UI[Web Dashboard &<br/>Interactive Charts]
        Verdict[Structured Verdict &<br/>Risk-Adjusted Trade Plan]
    end

    M --> T
    N & S --> Sent
    Macro --> Agent
    T & Sent --> Agent
    Agent <--> AI
    Agent --> Verdict
    T & Sent & Verdict --> UI
`

---

## 🚀 Quick Navigation
- **Repository**: [GitHub: AlGhozaliRamadhan/BOZ](https://github.com/AlGhozaliRamadhan/BOZ)
- **NPM Package**: [@agr77/boz](https://www.npmjs.com/package/@agr77/boz)
- **License**: [ISC License](https://github.com/AlGhozaliRamadhan/BOZ/blob/main/LICENSE)
