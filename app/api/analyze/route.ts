import { NextRequest, NextResponse } from "next/server";
import { analyzeBbEma } from "@/lib/bb-ema";
import { analyzeRsi } from "@/lib/rsi";
import {
  SCREENERS,
  modeId,
  type Strategy,
  type Timeframe,
  type ScreenerModeId,
} from "@/lib/types";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

function resolveModeId(body: {
  modeId?: string;
  strategy?: string;
  timeframe?: string;
}): ScreenerModeId | null {
  // Preferred: explicit modeId
  if (body.modeId && body.modeId in SCREENERS) {
    return body.modeId as ScreenerModeId;
  }

  // Backward compat: timeframe alone → BB
  const tf = (body.timeframe || "weekly") as Timeframe;
  if (tf !== "weekly" && tf !== "daily") return null;

  const strategy = (body.strategy || "bb") as Strategy;
  if (strategy !== "bb" && strategy !== "rsi70" && strategy !== "rsi10") {
    return null;
  }

  return modeId(strategy, tf);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw = String(body.symbol || "")
      .toUpperCase()
      .trim();

    if (!raw) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const mid = resolveModeId(body);
    if (!mid) {
      return NextResponse.json(
        {
          error:
            "Invalid mode. Use modeId (e.g. bb_weekly, rsi70_daily, rsi10_weekly) or strategy+timeframe",
        },
        { status: 400 }
      );
    }

    const cfg = SCREENERS[mid];
    const cacheKey = `${raw.toUpperCase()}:${mid}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    let result;
    if (cfg.strategy === "bb") {
      result = await analyzeBbEma(raw, cfg.timeframe);
    } else {
      result = await analyzeRsi(raw, mid);
    }

    if (result.error && result.barsAnalyzed === 0) {
      return NextResponse.json(result, { status: 200 });
    }

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to analyze symbol";
    console.error("Analyze error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    screeners: Object.values(SCREENERS).map((s) => ({
      id: s.id,
      strategy: s.strategy,
      timeframe: s.timeframe,
      label: s.label,
      description: s.description,
      interval: s.interval,
    })),
  });
}
