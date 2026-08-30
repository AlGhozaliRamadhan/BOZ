# Architecture & Core Engine

BOZ is designed with a **web-first, modular micro-architecture** built on Next.js 16 (React 19) and TypeScript.

---

## 🏛️ System Architecture

`mermaid
flowchart TD
    subgraph Client Layer
        Browser[Web Browser / Dashboard]
    end

    subgraph Launcher & Server
        CLI[Node.js CLI Launcher<br/>src/main.ts -> dist/main.js]
        NextServer[Next.js 16 Server<br/>App Router & API Routes]
    end

    subgraph Service Layer
        MarketSvc[Market Data Service<br/>yahoo-finance2 / Crypto / IDX]
        TechSvc[Technical Analysis Service<br/>technicalindicators]
        MacroSvc[Macro Regime Service]
        SentSvc[Sentiment & News Service<br/>RSS / Reddit / StockTwits]
        AgentSvc[Omni-Agent Orchestrator<br/>OpenAI SDK / Multi-Tool]
    end

    subgraph Storage & Cache Layer
        DiskCache[Disk Cache / Session Store<br/>~/.boz/ / data/]
    end

    Browser <--> NextServer
    CLI --> NextServer
    NextServer --> MarketSvc & TechSvc & MacroSvc & SentSvc & AgentSvc
    MarketSvc & TechSvc & MacroSvc & SentSvc & AgentSvc <--> DiskCache
`

---

## 📦 Key Architectural Components

### 1. Unified Launcher (src/main.ts -> dist/main.js)
- Compiles via 	sc -p tsconfig.launcher.json into a standalone CLI binary.
- Automatically finds an open local port (default: 21526), spawns the Next.js production web server, checks endpoint readiness with exponential backoff, and automatically opens the user's default web browser.

### 2. Next.js 16 Standalone App Router
- Modern React 19 UI utilizing server components and client components.
- Real-time client state management for active ticker symbols, timeframe selection, and conversational Omni-Agent chat history.
- Bundled with Next.js Standalone build artifacts for zero-external-dependency execution.

### 3. Asynchronous Data & Indicator Pipeline
- **Concurrent Ingestion**: Market quotes, historical candles, news feeds, and sentiment indices are retrieved in parallel using Promise.allSettled.
- **Fault-Tolerant Degraded Modes**: If an external provider (e.g. StockTwits or Fear & Greed) experiences downtime, BOZ falls back gracefully without crashing the analysis session.
- **Local Persistence**: User preferences and agent session context are stored locally on disk.
