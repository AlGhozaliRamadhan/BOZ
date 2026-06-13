# Changelog: BOZ v2.1.0 (2026-06-13)

Welcome to **Behavioral Outlook Zone v2.1.0**! This release significantly redesigns the user experience by centralizing the analysis modules into a single, unified Omni-Agent Chat interface.

## 🚀 Major Features

### Unified Omni-Agent Chat Interface
- **Consolidated UI**: Replaced the fragmented layout of separate modules with a core borderless chat interface. All analyses now run through a single, immersive chat terminal, streamlining your workflow.
- **Natural Conversations**: The app now completely relies on natural conversational prompts to navigate market data and generate intel.

### Slash Commands Integration
- **`/intraday [ticker]`**: Trigger a 2–6 hour momentum, volatility, and multi-timeframe confluence analysis. 
- **`/longterm [ticker]`**: Trigger a 3–12 month SMA structure and 52-week context analysis.
- **`/newsintel`**: Trigger cross-asset multi-source news aggregation and crowd sentiment scoring.

### Real-Time Streaming & Engine Upgrades
- **Streaming Responses**: Introduced robust chat streaming via `src/app/api/chat/stream/route.ts` for a faster, real-time typing experience.
- **Analysis Cards UI**: Render structured outputs elegantly within the chat via the newly added `AnalysisCards.tsx` component.
- **Dedicated Verdict APIs**: Added fast analysis evaluation routes (`intraday/verdict` and `longterm/verdict`) to efficiently power chat components.

## 🛠 Refactoring & Cleanups
- Massive restructuring of the `/chat` architecture with `chat.engine.ts` and `ChatComponent.tsx` handling the orchestration of user queries and the unified tool executions.
- Deprecated legacy separate page modules in favor of the newly refined text-based Omni-Agent approach.
