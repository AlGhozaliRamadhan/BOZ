# BOZ v1.5.4 Changelog

**Date:** May 9, 2026

## 🚀 Added

- **Multi-Ticker Market Analysis:**
  - Expanded the `AI Market Analyzer` modes (Intraday and Long-Term) to dynamically support multiple tickers, no longer hardcoding `NVDA`.
  - Added an interactive ticker picker to the `/run` CLI command.
  - Users can now select between `NVDA (Nvidia Corp)` and `SPY (S&P 500 ETF)` immediately after selecting the `AI Market Analyzer` mode.

## 🛠️ Changed

- **Sentiment Service Updates:**
  - Upgraded `SentimentService` to dynamically query the StockTwits stream for the currently active `config.ticker` instead of relying on a hardcoded endpoint for `NVDA.json`.
  - Re-mapped the `stocktwits_nvda` data structure property to a generalized `stocktwits_data` across all analyzers and AI synthesis logic.
- **AI Prompt Templates:**
  - Generalized the prompt templates in `prompts.ts` and `ai.service.ts` to substitute the chosen ticker into the analysis guidelines and output constraints (e.g. "You are a senior {ticker} stock analyst...").
  - Ensured Stocktwits sentiment values inject the correct dynamic variables.

## 🐛 Fixed

- Resolved hardcoded UI display references in the Intraday and Long-term analyzer output interfaces, allowing correct logging tags and titles for whatever ticker is being actively monitored.
