import { NextRequest, NextResponse } from "next/server";
import { analyzeBbEma } from "@/lib/bb-ema";
import { SCREENERS, type Timeframe } from "@/lib/types";
import { toYahooSymbol } from "@/lib/symbols";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw = String(body.symbol || "")
      .toUpperCase()
      .trim();
    const timeframe = (body.timeframe || "weekly") as Timeframe;

    if (!raw) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }
    if (!SCREENERS[timeframe]) {
      return NextResponse.json(
        { error: "timeframe must be 'weekly' or 'daily'" },
        { status: 400 }
      );
    }

    const ySymbol = toYahooSymbol(raw);
    const cacheKey = `${ySymbol}:${timeframe}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const result = await analyzeBbEma(raw, timeframe);

    if (result.error && result.barsAnalyzed === 0) {
      return NextResponse.json(result, { status: 200 });
    }

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to analyze symbol";
    console.error("BB-EMA analyze error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    screeners: Object.values(SCREENERS).map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      bbLength: s.bbLength,
      bbMult: s.bbMult,
      emaLen: s.emaLen,
      interval: s.interval,
    })),
  });
}
