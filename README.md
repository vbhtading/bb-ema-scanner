# BB(on EMA) NSE Screener

Next.js screener that ports the TradingView PineScript indicator **BB(on EMA) + EMA Buy-Only Scanner** to Indian (NSE) stocks.

## Screeners

| Mode | Timeframe | BB Length | BB Mult | EMA Length |
|------|-----------|-----------|---------|------------|
| **Weekly** | Weekly candle close | 50 | 2.0 | 2 |
| **Daily** | Daily candle close | 50 | 0.7 | 20 |

## Signal logic (matches Pine)

```
emaVal = EMA(close, emaLen)
basis  = SMA(emaVal, bbLength)      // BB is on EMA, not raw close
dev    = bbMult * STDEV(emaVal, bbLength)
upper  = basis + dev
lower  = basis - dev

BUY  : close > upper AND close > emaVal  (one-shot until exit)
EXIT : close < lower                     (resets long state)
```

Position state is emulated bar-by-bar (`var bool inLong`) so BUY/EXIT fire once each cycle.

## Data

Market data from **Yahoo Finance** (`yahoo-finance2`, Node equivalent of Python `yfinance`) with `.NS` symbols.

## Run

```bash
cd bb-ema-scanner
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), pick Weekly or Daily, then **Run Scan**.

## API

```http
POST /api/analyze
Content-Type: application/json

{ "symbol": "RELIANCE", "timeframe": "weekly" }
```

`timeframe`: `"weekly"` | `"daily"`

```http
GET /api/analyze
```

Returns screener config metadata.
