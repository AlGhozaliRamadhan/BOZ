# Technical Analysis & Market Regimes

BOZ implements a comprehensive technical analysis engine designed to evaluate price action, momentum, volatility, volume flow, and multi-timeframe market structure.

---

## 📈 Supported Indicators & Formulas

| Indicator | Parameters | Role in Thesis |
|---|---|---|
| **RSI (Relative Strength Index)** | 14-period default | Evaluates overbought (>70) and oversold (<30) momentum conditions, plus bullish/bearish divergences. |
| **MACD (Moving Average Convergence Divergence)** | 12, 26, 9 | Measures momentum shifts, trend acceleration, and signal line crossovers. |
| **Bollinger Bands** | 20-period SMA, 2.0 StdDev | Identifies volatility squeezes, mean reversion extremes, and breakout expansion zones. |
| **ATR (Average True Range)** | 14-period | Provides market volatility metric used for dynamic Stop Loss calculations and position sizing. |
| **OBV (On-Balance Volume)** | Cumulative volume | Detects institutional accumulation or distribution preceding price movements. |
| **Moving Averages (SMA / EMA)** | 20, 50, 200-period | Defines short-term trend, intermediate momentum, and macro bull/bear regime thresholds. |
| **Fibonacci Retracements** | 0.236, 0.382, 0.500, 0.618, 0.786 | Calculates high-probability reaction zones during trend pullbacks. |

---

## 🏗️ Market Structure & Trend Characterization

BOZ classifies market trends using systematic price-swing analysis:

- **Bullish Structure (HH/HL)**: Higher Highs and Higher Lows. Pullbacks to key moving averages are treated as potential continuation entries.
- **Bearish Structure (LH/LL)**: Lower Highs and Lower Lows. Rallies into resistance are treated as risk-off or short-side opportunities.
- **Consolidation / Range-Bound**: Price oscillating between defined horizontal support and resistance boundaries with contracting ATR.

`
       [High 2] (HH)
         /\         
        /  \   [High 3] (HH)
       /    \    /\
[High 1]     \  /  \
  /\          \/    \
 /  \       [Low 2]  \
/    \ (HL)   (HL)    \
      \/               \/
    [Low 1]          [Low 3]
`

---

## 🔄 Multi-Timeframe Alignment

The engine cross-examines daily, 4-hour, and 1-hour timeframes to prevent false breakout signals:
- **Macro Trend (Daily)**: Dictates overall trade bias.
- **Intermediate Wave (4H)**: Identifies swing structure and key levels.
- **Execution Level (1H)**: Pinpoints precision entry trigger and invalidation point.
