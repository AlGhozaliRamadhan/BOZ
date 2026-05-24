# BOZ v1.6.2 Changelog

## Overview
Version 1.6.2 introduces a major paradigm shift in how the conversational agent processes tasks and manages memory. The primary focus of this release is on concurrent tool execution, sub-agent delegation, and resilient memory persistence, making the agent significantly faster and more capable of handling complex, multi-step analytical workflows.

## Key Improvements

### 1. Concurrent Tool Execution
- **Parallel Processing**: The core tool-calling loop (`executeTool`) was completely refactored to use `Promise.all`. When the AI issues multiple tool calls (e.g., fetching a price and pulling news simultaneously), they are now executed in parallel.
- **Visual Overhaul**: The CLI renderer was updated to support a clean, spinner-based UX that clearly displays concurrent tool execution status and completion metrics.

### 2. Autonomous Sub-Agents & Personas
- **`summon_agent` Tool**: The main BOZ agent can now delegate heavy analytical tasks to specialized sub-agents.
- **Context Injection**: Sub-agents are no longer "blind"; they receive the full conversation history and the verified data ledger before beginning their analysis.
- **Distinct Personas**: Added three highly specialized personas:
  - **QuantBrain**: Focuses strictly on technical indicators, math, and risk-reward ratios.
  - **NewsHound**: Specializes in reading macro-economic events and crowd sentiment.
  - **RiskManager**: Acts as a strict devil's advocate to identify flaws and red flags in any trade setup.
- **UI Polish**: Sub-agents feature randomized, personality-driven loading spinners to give the CLI a more organic feel.

### 3. Persistent Memory System
- **`MemoryService` Integration**: Implemented a new local disk-backed memory ledger.
- **`update_memory` Tool**: BOZ can now permanently remember user preferences, trading styles, and rules across multiple sessions, injecting them automatically into the system prompt at startup.

### 4. Resiliency & Stability
- **Exponential Backoff**: Integrated `withRetry` logic to wrap fragile API calls (like Yahoo Finance endpoints), ensuring stability during rate-limiting or network spikes.
- **Prompt Leakage Fix**: Separated the system prompt used for the brief acknowledgment AI call from the heavy main system prompt, preventing the AI from hallucinating or printing "Chain of Thought" reasoning into the terminal.

### 5. Build & Distribution Optimizations
- **`.npmignore` Implementation**: Prevented source code, tests, and markdown files from being packaged into the final executable. This reduced the total packaged file count from 108 down to 44, cutting the install size by roughly 60%.
- **`.gitignore` Hardening**: Added exclusions for local cache files (`.eslintcache`) and compiled tarballs to keep the repository clean.
- **Strict Formatting Policy**: Replaced markdown tables with bulleted lists in the system prompt to prevent terminal wrapping issues.

## Technical Debt Addressed
- Cleaned up the `src/services/` directory by organizing services into logical subdirectories (`core/`, `market/`, `ai/`, `news/`, `search/`).
- Removed legacy, isolated tool classes in favor of a centralized ReAct tool loop.
