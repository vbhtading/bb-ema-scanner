# NSE Multi-Screener (BB + RSI)

Next.js app for Indian (NSE) stocks with **six** screeners in one UI.

## Screeners

### BB(on EMA)

| Mode | Timeframe | BB | EMA |
|------|-----------|-----|-----|
| BB | Weekly | 50, 2.0 | 2 |
| BB | Daily | 50, 0.7 | 20 |

```
emaVal = EMA(close, emaLen)
BB on EMA series (not raw close)
BUY  : close > upper AND close > emaVal  (one-shot)
EXIT : close < lower
```

### RSI (source = EMA 21)

| Mode | Timeframe | RSI | Source | Entry | Exit |
|------|-----------|-----|--------|-------|------|
| RSI≥70 | Weekly / Daily | 10 | EMA(close,21) | Fresh cross **above 70** | Cross **above 90** or **below 55** |
| RSI≥10 | Weekly / Daily | 10 | EMA(close,21) | Fresh cross **above 10** | Cross **below 10** |

All RSI signals are **fresh crosses only** (one-shot position state).

## Data

Yahoo Finance (`yahoo-finance2`) · `.NS` symbols.

## Run

```bash
cd bb-ema-scanner
npm install
npm run dev
```

Pick **BB / RSI≥70 / RSI≥10**, then **Weekly / Daily**, then **Run Scan**.

## API

```http
POST /api/analyze
{ "symbol": "RELIANCE", "strategy": "rsi70", "timeframe": "weekly" }
```

Or explicit: `{ "symbol": "TCS", "modeId": "rsi10_daily" }`

`strategy`: `bb` | `rsi70` | `rsi10`  
`timeframe`: `weekly` | `daily`

```http
GET /api/analyze
```

Returns all screener configs.
