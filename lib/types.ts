/**
 * Client-safe types and screener configs (no Node / yahoo-finance2 imports).
 */

export type Timeframe = "weekly" | "daily";

export interface ScreenerConfig {
  id: Timeframe;
  label: string;
  description: string;
  interval: "1wk" | "1d";
  bbLength: number;
  bbMult: number;
  emaLen: number;
  lookbackYears: number;
  minBars: number;
}

export const SCREENERS: Record<Timeframe, ScreenerConfig> = {
  weekly: {
    id: "weekly",
    label: "Weekly · BB(50, 2) + EMA(2)",
    description:
      "Weekly candle close · Bollinger Bands on EMA(2) with length 50, mult 2.0",
    interval: "1wk",
    bbLength: 50,
    bbMult: 2.0,
    emaLen: 2,
    lookbackYears: 3,
    minBars: 55,
  },
  daily: {
    id: "daily",
    label: "Daily · BB(50, 0.7) + EMA(20)",
    description:
      "Daily candle close · Bollinger Bands on EMA(20) with length 50, mult 0.7",
    interval: "1d",
    bbLength: 50,
    bbMult: 0.7,
    emaLen: 20,
    lookbackYears: 1.5,
    minBars: 80,
  },
};

export interface Candle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BbEmaResult {
  symbol: string;
  name: string;
  timeframe: Timeframe;
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
