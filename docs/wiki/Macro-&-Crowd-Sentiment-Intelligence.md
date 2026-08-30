# Macro & Crowd Sentiment Intelligence

Market direction is frequently determined by macro liquidity cycles and crowd psychology. BOZ incorporates dedicated sentiment ingestors and macroeconomic barometers into every analysis thesis.

---

## 🌐 Macroeconomic Barometers

`mermaid
flowchart TD
    Macro[Macro Economic Drivers] --> DXY[US Dollar Index / DXY]
    Macro --> TNX[10-Year Treasury Yield / TNX]
    Macro --> BTCD[Bitcoin Dominance / BTC.D]
    Macro --> SPX[S&P 500 Equity Index]

    DXY & TNX & BTCD & SPX --> Reg[Macro Regime Classifier]
    Reg --> Output[Risk-On vs Risk-Off Thesis]
`

- **US Dollar Index (DXY)**: Measures greenback strength against major currency baskets; inversely correlated with equities and crypto risk assets.
- **US 10-Year Treasury Yield (TNX)**: Benchmark global discount rate; rising yields pressure growth valuations.
- **Bitcoin Dominance (BTC.D)**: Distinguishes between BTC liquidity-absorption phases and Altcoin rotation regimes.

---

## 👥 Crowd Sentiment & Social Intelligence

### 1. Crypto Fear & Greed Index
- Real-time gauge ranging from **0 (Extreme Fear)** to **100 (Extreme Greed)**.
- Used as a contrarian indicator: extreme fear often coincides with accumulation bottoms, while extreme greed marks distribution zones.

### 2. Social Sentiment Aggregation
- **StockTwits Sentiment**: Normalized bull/bear message ratio and volume spike detector.
- **Reddit Ingest**: Monitors retail discussion volume and keyword trends across market subreddits.
- **Symbol Normalization**: Automatically converts Yahoo crypto tickers (BTC-USD, ETH-USD) to social forum conventions ($BTC.X, $ETH.X) for accurate stream matching.

### 3. News & RSS Curation
- Pulls live market headlines and RSS streams.
- Filters out noise and summarizes key catalyst events (earnings releases, central bank decisions, protocol upgrades).
