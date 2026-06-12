# Changelog: BOZ v2.0.0 (2026-06-12)

Welcome to **Behavioral Outlook Zone v2.0.0**! This major release transforms BOZ from a terminal-native CLI engine into a full-stack, Next.js-powered web intelligence dashboard.

## 🚀 Major Features

### Full-Stack Web Application Architecture
- **Next.js App Router**: Transitioned the entire CLI logic into a modern, highly responsive Next.js web application.
- **Sleek UI/UX**: Designed a premium, dark-mode fintech interface using glassmorphism, responsive grid layouts, and smooth micro-animations.
- **Dynamic Routing**: Replaced CLI prompts with intuitive routing (e.g., `/analyze/intraday?ticker=NVDA`, `/chat`, `/idx-scanner`).

### Interactive Dashboard
- **Real-time Metrics**: Live market regime classification, VIX volatility, and Fear & Greed sentiment visualized on an interactive dashboard.
- **Deep Analytics Integration**: Intraday and Long-term analysis engines seamlessly ported into visually rich cards, complete with trade levels and gauges.

### Docker Support
- **Containerization**: Shipped a multi-stage `Dockerfile` and `docker-compose.yml` to effortlessly run the BOZ app securely in a container with a single command.
- **Optimized Standalone Build**: Configured Next.js output for `standalone` mode to keep the production image extremely lean.

### Enhanced User Settings
- **In-App Provider Switching**: Users can now swap AI providers (GitHub Models, NVIDIA NIM, Offline) and manage API keys directly from the `/settings` UI page without modifying `.env` files.

## 🛠 Refactoring & Cleanup
- Modularized a massive 1,200-line monolithic CSS file into clean, scalable modules (`tokens.css`, `components.css`, `layout.css`).
- Cleaned up unused CLI scripts (`dev:cli`, `build:cli`, `start:cli`) from `package.json`.
- Removed terminal formatting dependencies from core rendering logic and adapted them for HTML/React outputs.

## 🐛 Bug Fixes
- Fixed an aggressive rate-limit issue on Reddit mentions (429 errors) by migrating to RSS endpoints and implementing a 5-minute memory cache.
- Resolved Strict Mode double-fetching bugs causing zeroed-out social buzz data.

## 🔜 Up Next
- Advanced portfolio tracking.
- WebSockets for streaming live price updates.
- Expansion of the Interactive Chat Agent's persistent memory capabilities.
