/**
 * BB(on EMA) + EMA Buy-Only Scanner
 * Faithful port of the Pine Script v5 indicator:
 *
 *   emaVal = ta.ema(close, emaLen)
 *   basis  = ta.sma(emaVal, bbLength)
 *   dev    = bbMult * ta.stdev(emaVal, bbLength)
 *   upper  = basis + dev
 *   lower  = basis - dev
 *   entry  = close > upper and close > emaVal
 *   exit   = close < lower
 *
 * With one-shot buy/exit signals via position-state emulation.
 */

import YahooFinance from "yahoo-finance2";
import {
  SCREENERS,
  type Timeframe,
  type Candle,
  type BbEmaResult,
} from "@/lib/types";

export type { Timeframe, Candle, BbEmaResult, ScreenerConfig } from "@/lib/types";
export { SCREENERS } from "@/lib/types";

const yahoo = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});

// ─── Math helpers (match Pine ta.* as closely as possible) ──────────────────

/** ta.ema — seeds with SMA of first `period` valid values */
function emaSeries(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length === 0 || period < 1) return out;

  const k = 2 / (period + 1);
  let ema = NaN;
  let seedSum = 0;
  let seedCount = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNaN(v)) {
      out[i] = NaN;
      continue;
    }

    if (isNaN(ema)) {
      seedSum += v;
      seedCount++;
      if (seedCount >= period) {
        ema = seedSum / seedCount;
        out[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

/** ta.sma — simple moving average over last `period` values */
function smaSeries(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (period < 1) return out;

  let sum = 0;
  const window: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNaN(v)) {
      out[i] = NaN;
      sum = 0;
      window.length = 0;
      continue;
    }

    window.push(v);
    sum += v;

    if (window.length > period) {
      sum -= window.shift()!;
    }

    if (window.length === period) {
      out[i] = sum / period;
    }
  }
  return out;
}

/**
 * ta.stdev — biased (population) standard deviation.
 * Pine docs: "biased estimate of standard deviation" → divide by N.
 */
function stdevSeries(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (period < 1) return out;

  const window: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNaN(v)) {
      out[i] = NaN;
      window.length = 0;
      continue;
    }

    window.push(v);
    if (window.length > period) window.shift();

    if (window.length === period) {
      const mean = window.reduce((a, b) => a + b, 0) / period;
      let variance = 0;
      for (const x of window) variance += (x - mean) ** 2;
      variance /= period;
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

// ─── Core signal engine ─────────────────────────────────────────────────────

export interface BarSignals {
  ema: number[];
  basis: number[];
  upper: number[];
  lower: number[];
  entryCond: boolean[];
  exitCond: boolean[];
  buySignal: boolean[];
  exitSignal: boolean[];
  inLong: boolean[];
}

/**
 * Full bar-by-bar computation matching the Pine indicator,
 * including var bool inLong position-state emulation.
 */
export function computeBbEmaSignals(
  closes: number[],
  bbLength: number,
  bbMult: number,
  emaLen: number
): BarSignals {
  const n = closes.length;
  const ema = emaSeries(closes, emaLen);
  const basis = smaSeries(ema, bbLength);
  const stdev = stdevSeries(ema, bbLength);

  const upper = new Array(n).fill(NaN);
  const lower = new Array(n).fill(NaN);
  const entryCond = new Array(n).fill(false);
  const exitCond = new Array(n).fill(false);
  const buySignal = new Array(n).fill(false);
  const exitSignal = new Array(n).fill(false);
  const inLongArr = new Array(n).fill(false);

  let inLong = false;

  for (let i = 0; i < n; i++) {
    const e = ema[i];
    const b = basis[i];
    const s = stdev[i];
    const c = closes[i];

    if (!isNaN(b) && !isNaN(s)) {
      upper[i] = b + bbMult * s;
      lower[i] = b - bbMult * s;
    }

    const hasBands = !isNaN(upper[i]) && !isNaN(lower[i]) && !isNaN(e);

    entryCond[i] = hasBands && c > upper[i] && c > e;
    exitCond[i] = hasBands && c < lower[i];

    buySignal[i] = false;
    exitSignal[i] = false;

    if (!inLong && entryCond[i]) {
      buySignal[i] = true;
      inLong = true;
    } else if (inLong && exitCond[i]) {
      exitSignal[i] = true;
      inLong = false;
    }

    inLongArr[i] = inLong;
  }

  return {
    ema,
    basis,
    upper,
    lower,
    entryCond,
    exitCond,
    buySignal,
    exitSignal,
    inLong: inLongArr,
  };
}

// ─── Empty / error result ───────────────────────────────────────────────────

function emptyResult(
  symbol: string,
  name: string,
  timeframe: Timeframe,
  error?: string
): BbEmaResult {
  return {
    symbol,
    name,
    timeframe,
    ltp: 0,
    changePct: 0,
    lastClose: 0,
    lastDate: "",
    ema: null,
    bbBasis: null,
    bbUpper: null,
    bbLower: null,
    pctAboveUpper: null,
    pctBelowLower: null,
    pctVsEma: null,
    entryCond: false,
    exitCond: false,
    buySignal: false,
    exitSignal: false,
    inLong: false,
    status: "FLAT",
    reasons: [error || "Insufficient data"],
    barsAnalyzed: 0,
    recentCandles: [],
    lastUpdated: new Date().toISOString(),
    error,
  };
}

// ─── Main analyzer ──────────────────────────────────────────────────────────

export async function analyzeBbEma(
  rawSymbol: string,
  timeframe: Timeframe,
  providedName?: string
): Promise<BbEmaResult> {
  const cfg = SCREENERS[timeframe];
  const symbol = rawSymbol
    .toUpperCase()
    .trim()
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");
  const ySymbol = `${symbol}.NS`;

  const end = new Date();
  const start = new Date();
  const years = cfg.lookbackYears;
  start.setFullYear(start.getFullYear() - Math.floor(years));
  if (years % 1 !== 0) {
    start.setMonth(start.getMonth() - Math.round((years % 1) * 12));
  }

  let hist: Array<Record<string, unknown>> = [];
  try {
    const chartResult = await yahoo.chart(ySymbol, {
      period1: start,
      period2: end,
      interval: cfg.interval,
    });
    hist = (chartResult?.quotes || []) as Array<Record<string, unknown>>;
  } catch {
    try {
      const shortStart = new Date();
      shortStart.setFullYear(shortStart.getFullYear() - 1);
      const chartResult = await yahoo.chart(ySymbol, {
        period1: shortStart,
        period2: end,
        interval: cfg.interval,
      });
      hist = (chartResult?.quotes || []) as Array<Record<string, unknown>>;
    } catch {
      return emptyResult(
        symbol,
        providedName || symbol,
        timeframe,
        `Failed to fetch ${cfg.interval} data`
      );
    }
  }

  const candles: Candle[] = (hist || [])
    .filter((r) => r && r.close != null && !isNaN(Number(r.close)))
    .map((r) => ({
      date: new Date(r.date as string | number | Date).toISOString().slice(0, 10),
      timestamp: new Date(r.date as string | number | Date).getTime(),
      open: Number(r.open ?? r.close),
      high: Number(r.high ?? r.close),
      low: Number(r.low ?? r.close),
      close: Number(r.close),
      volume: Number(r.volume ?? 0),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (candles.length < cfg.minBars) {
    return emptyResult(
      symbol,
      providedName || symbol,
      timeframe,
      `Need ≥${cfg.minBars} bars, got ${candles.length}`
    );
  }

  const closes = candles.map((c) => c.close);
  const signals = computeBbEmaSignals(
    closes,
    cfg.bbLength,
    cfg.bbMult,
    cfg.emaLen
  );

  const last = candles.length - 1;
  const lastCandle = candles[last];
  const prevCandle = candles[last - 1];

  let ltp = lastCandle.close;
  let changePct = prevCandle
    ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
    : 0;
  let displayName = providedName || symbol;

  try {
    const q = (await yahoo.quote(ySymbol)) as Record<string, unknown>;
    if (q?.regularMarketPrice != null) ltp = Number(q.regularMarketPrice);
    if (q?.regularMarketChangePercent != null)
      changePct = Number(q.regularMarketChangePercent);
    if (typeof q?.shortName === "string") displayName = q.shortName;
    else if (typeof q?.longName === "string") displayName = q.longName;
  } catch {
    // keep candle-derived values
  }

  const ema = isNaN(signals.ema[last])
    ? null
    : Number(signals.ema[last].toFixed(2));
  const bbBasis = isNaN(signals.basis[last])
    ? null
    : Number(signals.basis[last].toFixed(2));
  const bbUpper = isNaN(signals.upper[last])
    ? null
    : Number(signals.upper[last].toFixed(2));
  const bbLower = isNaN(signals.lower[last])
    ? null
    : Number(signals.lower[last].toFixed(2));

  const close = lastCandle.close;
  const pctAboveUpper =
    bbUpper != null && bbUpper !== 0
      ? Number((((close - bbUpper) / bbUpper) * 100).toFixed(2))
      : null;
  const pctBelowLower =
    bbLower != null && bbLower !== 0
      ? Number((((bbLower - close) / bbLower) * 100).toFixed(2))
      : null;
  const pctVsEma =
    ema != null && ema !== 0
      ? Number((((close - ema) / ema) * 100).toFixed(2))
      : null;

  const buySignal = signals.buySignal[last];
  const exitSignal = signals.exitSignal[last];
  const inLong = signals.inLong[last];
  const entryCond = signals.entryCond[last];
  const exitCond = signals.exitCond[last];

  let status: BbEmaResult["status"] = "FLAT";
  if (buySignal) status = "BUY";
  else if (exitSignal) status = "EXIT";
  else if (inLong) status = "IN_LONG";

  const reasons: string[] = [];
  const tfLabel = timeframe === "weekly" ? "weekly" : "daily";

  if (buySignal) {
    reasons.push(
      `BUY: ${tfLabel} close ${close.toFixed(2)} broke above upper BB (${bbUpper}) and EMA(${cfg.emaLen})=${ema}`
    );
  } else if (exitSignal) {
    reasons.push(
      `EXIT: ${tfLabel} close ${close.toFixed(2)} fell below lower BB (${bbLower})`
    );
  } else if (inLong) {
    reasons.push(
      "IN LONG: position open since prior entry; waiting for lower-band exit"
    );
    if (entryCond)
      reasons.push("Still meeting entry conditions (close > upper & EMA)");
  } else {
    reasons.push("FLAT: no open position");
    if (bbUpper != null && close <= bbUpper)
      reasons.push(`Close ≤ upper BB (${bbUpper})`);
    if (ema != null && close <= ema)
      reasons.push(`Close ≤ EMA(${cfg.emaLen})=${ema}`);
  }

  if (pctAboveUpper != null && pctAboveUpper > 0) {
    reasons.push(`${pctAboveUpper.toFixed(1)}% above upper band`);
  }
  if (pctBelowLower != null && pctBelowLower > 0) {
    reasons.push(`${pctBelowLower.toFixed(1)}% below lower band`);
  }

  return {
    symbol,
    name: displayName,
    timeframe,
    ltp: Number(ltp.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    lastClose: Number(close.toFixed(2)),
    lastDate: lastCandle.date,
    ema,
    bbBasis,
    bbUpper,
    bbLower,
    pctAboveUpper,
    pctBelowLower,
    pctVsEma,
    entryCond,
    exitCond,
    buySignal,
    exitSignal,
    inLong,
    status,
    reasons: Array.from(new Set(reasons)),
    barsAnalyzed: candles.length,
    recentCandles: candles.slice(-60),
    lastUpdated: new Date().toISOString(),
  };
}
