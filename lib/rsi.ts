/**
 * RSI scanner — PineScript v6 port with user rules:
 *
 *   rsiSource = ta.ema(close, 21)
 *   RSI length = 10  (user: "rsi 10")
 *   up   = ta.rma(max(change, 0), 10)
 *   down = ta.rma(-min(change, 0), 10)
 *   rsi  = standard Wilder RSI formula
 *
 * Variants:
 *   rsi70 — BUY: fresh cross above 70
 *           EXIT: fresh cross above 90 OR fresh cross below 55
 *   rsi10 — BUY: fresh cross above 10
 *           EXIT: fresh cross below 10 (reset)
 *
 * All signals are one-shot (fresh) via position-state emulation.
 */

import YahooFinance from "yahoo-finance2";
import {
  SCREENERS,
  type Timeframe,
  type Candle,
  type RsiScanResult,
  type ScreenerModeId,
  type RsiScreenerConfig,
} from "@/lib/types";

const yahoo = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});

// ─── Math (match Pine ta.ema / ta.rma) ──────────────────────────────────────

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

/** ta.rma — Wilder's smoothing; seed = SMA of first `period` values */
function rmaSeries(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (period < 1) return out;

  const alpha = 1 / period;
  let rma = NaN;
  let seedSum = 0;
  let seedCount = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNaN(v)) {
      out[i] = NaN;
      continue;
    }
    if (isNaN(rma)) {
      seedSum += v;
      seedCount++;
      if (seedCount >= period) {
        rma = seedSum / seedCount;
        out[i] = rma;
      }
    } else {
      rma = alpha * v + (1 - alpha) * rma;
      out[i] = rma;
    }
  }
  return out;
}

/**
 * Pine RSI on arbitrary source:
 *   change = ta.change(source)
 *   up = ta.rma(max(change,0), length)
 *   down = ta.rma(-min(change,0), length)
 *   rsi = down==0 ? 100 : up==0 ? 0 : 100 - 100/(1+up/down)
 */
export function rsiOnSource(source: number[], length: number): number[] {
  const n = source.length;
  const changes = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    if (!isNaN(source[i]) && !isNaN(source[i - 1])) {
      changes[i] = source[i] - source[i - 1];
    }
  }

  const gains = changes.map((c) => (isNaN(c) ? NaN : Math.max(c, 0)));
  const losses = changes.map((c) => (isNaN(c) ? NaN : -Math.min(c, 0)));

  const up = rmaSeries(gains, length);
  const down = rmaSeries(losses, length);

  const rsi = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const u = up[i];
    const d = down[i];
    if (isNaN(u) || isNaN(d)) continue;
    if (d === 0) rsi[i] = 100;
    else if (u === 0) rsi[i] = 0;
    else rsi[i] = 100 - 100 / (1 + u / d);
  }
  return rsi;
}

export function crossedAbove(
  prev: number,
  curr: number,
  level: number
): boolean {
  return !isNaN(prev) && !isNaN(curr) && prev <= level && curr > level;
}

export function crossedBelow(
  prev: number,
  curr: number,
  level: number
): boolean {
  return !isNaN(prev) && !isNaN(curr) && prev >= level && curr < level;
}

export interface RsiBarSignals {
  rsi: number[];
  ema21: number[];
  entryCond: boolean[];
  exitCond: boolean[];
  buySignal: boolean[];
  exitSignal: boolean[];
  inLong: boolean[];
}

export function computeRsiSignals(
  closes: number[],
  cfg: RsiScreenerConfig
): RsiBarSignals {
  const n = closes.length;
  const ema21 = emaSeries(closes, cfg.sourceEmaLen);
  const rsi = rsiOnSource(ema21, cfg.rsiLength);

  const entryCond = new Array(n).fill(false);
  const exitCond = new Array(n).fill(false);
  const buySignal = new Array(n).fill(false);
  const exitSignal = new Array(n).fill(false);
  const inLongArr = new Array(n).fill(false);

  let inLong = false;

  for (let i = 1; i < n; i++) {
    const prev = rsi[i - 1];
    const curr = rsi[i];
    if (isNaN(prev) || isNaN(curr)) {
      inLongArr[i] = inLong;
      continue;
    }

    const entry = crossedAbove(prev, curr, cfg.entryLevel);
    let exit = false;

    if (cfg.strategy === "rsi70") {
      // EXIT: cross above 90 OR fall back below 55
      exit =
        crossedAbove(prev, curr, cfg.exitHigh ?? 90) ||
        crossedBelow(prev, curr, cfg.exitLow ?? 55);
    } else {
      // rsi10 recovery: exit on fresh cross back below 10
      exit = crossedBelow(prev, curr, cfg.entryLevel);
    }

    entryCond[i] = entry;
    exitCond[i] = exit;

    if (!inLong && entry) {
      buySignal[i] = true;
      inLong = true;
    } else if (inLong && exit) {
      exitSignal[i] = true;
      inLong = false;
    }

    inLongArr[i] = inLong;
  }

  return { rsi, ema21, entryCond, exitCond, buySignal, exitSignal, inLong: inLongArr };
}

function emptyResult(
  symbol: string,
  name: string,
  modeId: ScreenerModeId,
  strategy: "rsi70" | "rsi10",
  timeframe: Timeframe,
  error?: string
): RsiScanResult {
  return {
    kind: "rsi",
    symbol,
    name,
    strategy,
    timeframe,
    modeId,
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
    rsi: null,
    prevRsi: null,
    ema21: null,
    entryCond: false,
    exitCond: false,
    buySignal: false,
    exitSignal: false,
    inLong: false,
    status: "FLAT",
    reasons: [error || "Insufficient data"],
    barsAnalyzed: 0,
    recentCandles: [],
    rsiHistory: [],
    lastUpdated: new Date().toISOString(),
    error,
  };
}

export async function analyzeRsi(
  rawSymbol: string,
  modeId: ScreenerModeId
): Promise<RsiScanResult> {
  const cfg = SCREENERS[modeId];
  if (cfg.strategy !== "rsi70" && cfg.strategy !== "rsi10") {
    throw new Error(`Not an RSI mode: ${modeId}`);
  }
  const rsiCfg = cfg as RsiScreenerConfig;

  const symbol = rawSymbol
    .toUpperCase()
    .trim()
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");
  const ySymbol = `${symbol}.NS`;

  const end = new Date();
  const start = new Date();
  const years = rsiCfg.lookbackYears;
  start.setFullYear(start.getFullYear() - Math.floor(years));
  if (years % 1 !== 0) {
    start.setMonth(start.getMonth() - Math.round((years % 1) * 12));
  }

  let hist: Array<Record<string, unknown>> = [];
  try {
    const chartResult = await yahoo.chart(ySymbol, {
      period1: start,
      period2: end,
      interval: rsiCfg.interval,
    });
    hist = (chartResult?.quotes || []) as Array<Record<string, unknown>>;
  } catch {
    try {
      const shortStart = new Date();
      shortStart.setFullYear(shortStart.getFullYear() - 1);
      const chartResult = await yahoo.chart(ySymbol, {
        period1: shortStart,
        period2: end,
        interval: rsiCfg.interval,
      });
      hist = (chartResult?.quotes || []) as Array<Record<string, unknown>>;
    } catch {
      return emptyResult(
        symbol,
        symbol,
        modeId,
        rsiCfg.strategy,
        rsiCfg.timeframe,
        `Failed to fetch ${rsiCfg.interval} data`
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

  if (candles.length < rsiCfg.minBars) {
    return emptyResult(
      symbol,
      symbol,
      modeId,
      rsiCfg.strategy,
      rsiCfg.timeframe,
      `Need ≥${rsiCfg.minBars} bars, got ${candles.length}`
    );
  }

  const closes = candles.map((c) => c.close);
  const signals = computeRsiSignals(closes, rsiCfg);

  const last = candles.length - 1;
  const lastCandle = candles[last];
  const prevCandle = candles[last - 1];

  let ltp = lastCandle.close;
  let changePct = prevCandle
    ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
    : 0;
  let displayName = symbol;

  try {
    const q = (await yahoo.quote(ySymbol)) as Record<string, unknown>;
    if (q?.regularMarketPrice != null) ltp = Number(q.regularMarketPrice);
    if (q?.regularMarketChangePercent != null)
      changePct = Number(q.regularMarketChangePercent);
    if (typeof q?.shortName === "string") displayName = q.shortName;
    else if (typeof q?.longName === "string") displayName = q.longName;
  } catch {
    // keep candle values
  }

  const rsi =
    isNaN(signals.rsi[last]) ? null : Number(signals.rsi[last].toFixed(2));
  const prevRsi =
    last > 0 && !isNaN(signals.rsi[last - 1])
      ? Number(signals.rsi[last - 1].toFixed(2))
      : null;
  const ema21 =
    isNaN(signals.ema21[last])
      ? null
      : Number(signals.ema21[last].toFixed(2));

  const buySignal = signals.buySignal[last];
  const exitSignal = signals.exitSignal[last];
  const inLong = signals.inLong[last];
  const entryCond = signals.entryCond[last];
  const exitCond = signals.exitCond[last];

  let status: RsiScanResult["status"] = "FLAT";
  if (buySignal) status = "BUY";
  else if (exitSignal) status = "EXIT";
  else if (inLong) status = "IN_LONG";

  const tfLabel = rsiCfg.timeframe;
  const reasons: string[] = [];

  if (buySignal) {
    if (rsiCfg.strategy === "rsi70") {
      reasons.push(
        `BUY: fresh RSI cross above ${rsiCfg.entryLevel} (${prevRsi} → ${rsi}) on ${tfLabel}`
      );
    } else {
      reasons.push(
        `BUY: fresh RSI cross above ${rsiCfg.entryLevel} (${prevRsi} → ${rsi}) on ${tfLabel} — recovery`
      );
    }
  } else if (exitSignal) {
    if (rsiCfg.strategy === "rsi70") {
      if (
        prevRsi != null &&
        rsi != null &&
        crossedAbove(prevRsi, rsi, rsiCfg.exitHigh ?? 90)
      ) {
        reasons.push(
          `EXIT: RSI crossed above ${rsiCfg.exitHigh} (${prevRsi} → ${rsi}) — overextended`
        );
      } else {
        reasons.push(
          `EXIT: RSI fell back below ${rsiCfg.exitLow} (${prevRsi} → ${rsi})`
        );
      }
    } else {
      reasons.push(
        `EXIT: RSI crossed back below ${rsiCfg.entryLevel} (${prevRsi} → ${rsi})`
      );
    }
  } else if (inLong) {
    reasons.push(
      `IN LONG: open since prior entry · RSI=${rsi} · waiting for exit`
    );
  } else {
    reasons.push("FLAT: no open position");
    if (rsi != null) {
      if (rsiCfg.strategy === "rsi70" && rsi <= rsiCfg.entryLevel) {
        reasons.push(`RSI ${rsi} ≤ ${rsiCfg.entryLevel} — waiting for cross up`);
      } else if (rsiCfg.strategy === "rsi10" && rsi <= rsiCfg.entryLevel) {
        reasons.push(`RSI ${rsi} ≤ ${rsiCfg.entryLevel} — still oversold`);
      }
    }
  }

  if (rsi != null) reasons.push(`RSI(10 on EMA21) = ${rsi}`);
  if (ema21 != null) reasons.push(`EMA(21) source = ${ema21}`);

  const rsiHistory = candles.slice(-60).map((c, idx) => {
    const globalIdx = candles.length - 60 + idx;
    const i = Math.max(0, globalIdx);
    const v = signals.rsi[i];
    return {
      date: c.date,
      rsi: isNaN(v) ? null : Number(v.toFixed(2)),
    };
  });

  return {
    kind: "rsi",
    symbol,
    name: displayName,
    strategy: rsiCfg.strategy,
    timeframe: rsiCfg.timeframe,
    modeId,
    ltp: Number(ltp.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    lastClose: Number(lastCandle.close.toFixed(2)),
    lastDate: lastCandle.date,
    ema: null,
    bbBasis: null,
    bbUpper: null,
    bbLower: null,
    pctAboveUpper: null,
    pctBelowLower: null,
    pctVsEma: null,
    rsi,
    prevRsi,
    ema21,
    entryCond,
    exitCond,
    buySignal,
    exitSignal,
    inLong,
    status,
    reasons: Array.from(new Set(reasons)),
    barsAnalyzed: candles.length,
    recentCandles: candles.slice(-60),
    rsiHistory,
    lastUpdated: new Date().toISOString(),
  };
}
