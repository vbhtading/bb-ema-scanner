/**
 * Client-safe types and screener configs (no Node / yahoo-finance2 imports).
 */

export type Timeframe = "weekly" | "daily";
export type Strategy = "bb" | "rsi70" | "rsi10";
export type ScreenerModeId =
  | "bb_weekly"
  | "bb_daily"
  | "rsi70_weekly"
  | "rsi70_daily"
  | "rsi10_weekly"
  | "rsi10_daily";

export interface Candle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** BB(on EMA) presets */
export interface BbScreenerConfig {
  id: ScreenerModeId;
  strategy: "bb";
  timeframe: Timeframe;
  label: string;
  description: string;
  interval: "1wk" | "1d";
  bbLength: number;
  bbMult: number;
  emaLen: number;
  lookbackYears: number;
  minBars: number;
}

/** RSI presets (source = EMA of close) */
export interface RsiScreenerConfig {
  id: ScreenerModeId;
  strategy: "rsi70" | "rsi10";
  timeframe: Timeframe;
  label: string;
  description: string;
  interval: "1wk" | "1d";
  /** RSI length (user: 10) */
  rsiLength: number;
  /** Source EMA length on close (Pine: ta.ema(close, 21)) */
  sourceEmaLen: number;
  /** Buy: fresh cross above this level */
  entryLevel: number;
  /** Exit: fresh cross above this (momentum only) */
  exitHigh?: number;
  /** Exit: fresh cross below this (momentum only) */
  exitLow?: number;
  lookbackYears: number;
  minBars: number;
}

export type ScreenerConfig = BbScreenerConfig | RsiScreenerConfig;

export const SCREENERS: Record<ScreenerModeId, ScreenerConfig> = {
  bb_weekly: {
    id: "bb_weekly",
    strategy: "bb",
    timeframe: "weekly",
    label: "Weekly · BB(50, 2) + EMA(2)",
    description:
      "Weekly close · Bollinger Bands on EMA(2) · length 50, mult 2.0",
    interval: "1wk",
    bbLength: 50,
    bbMult: 2.0,
    emaLen: 2,
    lookbackYears: 3,
    minBars: 55,
  },
  bb_daily: {
    id: "bb_daily",
    strategy: "bb",
    timeframe: "daily",
    label: "Daily · BB(50, 0.7) + EMA(20)",
    description:
      "Daily close · Bollinger Bands on EMA(20) · length 50, mult 0.7",
    interval: "1d",
    bbLength: 50,
    bbMult: 0.7,
    emaLen: 20,
    lookbackYears: 1.5,
    minBars: 80,
  },
  rsi70_weekly: {
    id: "rsi70_weekly",
    strategy: "rsi70",
    timeframe: "weekly",
    label: "Weekly · RSI(10) on EMA(21) · cross 70",
    description:
      "Weekly · RSI source EMA(21) · BUY fresh cross above 70 · EXIT >90 or <55",
    interval: "1wk",
    rsiLength: 10,
    sourceEmaLen: 21,
    entryLevel: 70,
    exitHigh: 90,
    exitLow: 55,
    lookbackYears: 3,
    minBars: 40,
  },
  rsi70_daily: {
    id: "rsi70_daily",
    strategy: "rsi70",
    timeframe: "daily",
    label: "Daily · RSI(10) on EMA(21) · cross 70",
    description:
      "Daily · RSI source EMA(21) · BUY fresh cross above 70 · EXIT >90 or <55",
    interval: "1d",
    rsiLength: 10,
    sourceEmaLen: 21,
    entryLevel: 70,
    exitHigh: 90,
    exitLow: 55,
    lookbackYears: 1.5,
    minBars: 80,
  },
  rsi10_weekly: {
    id: "rsi10_weekly",
    strategy: "rsi10",
    timeframe: "weekly",
    label: "Weekly · RSI(10) on EMA(21) · cross 10",
    description:
      "Weekly · RSI source EMA(21) · BUY fresh cross above 10 (recovery)",
    interval: "1wk",
    rsiLength: 10,
    sourceEmaLen: 21,
    entryLevel: 10,
    lookbackYears: 3,
    minBars: 40,
  },
  rsi10_daily: {
    id: "rsi10_daily",
    strategy: "rsi10",
    timeframe: "daily",
    label: "Daily · RSI(10) on EMA(21) · cross 10",
    description:
      "Daily · RSI source EMA(21) · BUY fresh cross above 10 (recovery)",
    interval: "1d",
    rsiLength: 10,
    sourceEmaLen: 21,
    entryLevel: 10,
    lookbackYears: 1.5,
    minBars: 80,
  },
};

/** Backward-compat aliases used by older BB-only UI */
export const BB_SCREENERS = {
  weekly: SCREENERS.bb_weekly as BbScreenerConfig,
  daily: SCREENERS.bb_daily as BbScreenerConfig,
};

export function modeId(strategy: Strategy, timeframe: Timeframe): ScreenerModeId {
  if (strategy === "bb") return timeframe === "weekly" ? "bb_weekly" : "bb_daily";
  if (strategy === "rsi70")
    return timeframe === "weekly" ? "rsi70_weekly" : "rsi70_daily";
  return timeframe === "weekly" ? "rsi10_weekly" : "rsi10_daily";
}

export interface BbEmaResult {
  kind: "bb";
  symbol: string;
  name: string;
  strategy: "bb";
  timeframe: Timeframe;
  modeId: ScreenerModeId;
  ltp: number;
  changePct: number;
  lastClose: number;
  lastDate: string;

  ema: number | null;
  bbBasis: number | null;
  bbUpper: number | null;
  bbLower: number | null;

  pctAboveUpper: number | null;
  pctBelowLower: number | null;
  pctVsEma: number | null;

  // RSI not used
  rsi: null;
  prevRsi: null;
  ema21: null;

  entryCond: boolean;
  exitCond: boolean;
  buySignal: boolean;
  exitSignal: boolean;
  inLong: boolean;

  status: "BUY" | "EXIT" | "IN_LONG" | "FLAT";
  reasons: string[];

  barsAnalyzed: number;
  recentCandles: Candle[];
  lastUpdated: string;
  error?: string;
}

export interface RsiScanResult {
  kind: "rsi";
  symbol: string;
  name: string;
  strategy: "rsi70" | "rsi10";
  timeframe: Timeframe;
  modeId: ScreenerModeId;
  ltp: number;
  changePct: number;
  lastClose: number;
  lastDate: string;

  // BB not used
  ema: null;
  bbBasis: null;
  bbUpper: null;
  bbLower: null;
  pctAboveUpper: null;
  pctBelowLower: null;
  pctVsEma: null;

  rsi: number | null;
  prevRsi: number | null;
  ema21: number | null;

  entryCond: boolean;
  exitCond: boolean;
  buySignal: boolean;
  exitSignal: boolean;
  inLong: boolean;

  status: "BUY" | "EXIT" | "IN_LONG" | "FLAT";
  reasons: string[];

  barsAnalyzed: number;
  recentCandles: Candle[];
  /** last N RSI values for chart */
  rsiHistory: { date: string; rsi: number | null }[];
  lastUpdated: string;
  error?: string;
}

export type ScanResult = BbEmaResult | RsiScanResult;

export const STRATEGY_META: Record<
  Strategy,
  { label: string; short: string; color: string }
> = {
  bb: {
    label: "BB(on EMA)",
    short: "BB",
    color: "blue",
  },
  rsi70: {
    label: "RSI cross 70",
    short: "RSI≥70",
    color: "violet",
  },
  rsi10: {
    label: "RSI cross 10",
    short: "RSI≥10",
    color: "amber",
  },
};
