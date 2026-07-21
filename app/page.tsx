"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Play,
  RefreshCw,
  Download,
  Search,
  X,
  TrendingUp,
  BarChart3,
  Clock,
  Target,
  Activity,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

import { STOCKS } from "@/lib/symbols";
import type {
  ScanResult as BaseScanResult,
  Timeframe,
  Strategy,
  BbScreenerConfig,
  RsiScreenerConfig,
} from "@/lib/types";
import { SCREENERS, modeId, STRATEGY_META } from "@/lib/types";
import {
  formatINR,
  formatPercent,
  runWithConcurrency,
  statusColor,
  statusLabel,
} from "@/lib/utils";

type ScanResult = BaseScanResult & { scannedAt: string };
type SignalFilter = "ALL" | "BUY" | "EXIT" | "IN_LONG" | "FLAT" | "SIGNALS";

const CONCURRENCY = 6;

export default function MultiScanner() {
  const [strategy, setStrategy] = useState<Strategy>("bb");
  const [timeframe, setTimeframe] = useState<Timeframe>("weekly");
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ScanResult[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("SIGNALS");
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "status",
    dir: "desc",
  });
  const [selectedStock, setSelectedStock] = useState<ScanResult | null>(null);

  const activeModeId = modeId(strategy, timeframe);
  const cfg = SCREENERS[activeModeId];
  const isBb = strategy === "bb";
  const isRsi = !isBb;
  const universeSize = STOCKS.length;

  const resetScanState = () => {
    setResults([]);
    setLastScan(null);
    setSignalFilter("SIGNALS");
    setSelectedStock(null);
  };

  const counts = useMemo(() => {
    return {
      total: results.length,
      buy: results.filter((r) => r.buySignal).length,
      exit: results.filter((r) => r.exitSignal).length,
      inLong: results.filter((r) => r.inLong && !r.buySignal && !r.exitSignal).length,
      flat: results.filter((r) => r.status === "FLAT").length,
    };
  }, [results]);

  const filteredResults = useMemo(() => {
    let data = [...results];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      data = data.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }

    switch (signalFilter) {
      case "BUY":
        data = data.filter((r) => r.buySignal);
        break;
      case "EXIT":
        data = data.filter((r) => r.exitSignal);
        break;
      case "IN_LONG":
        data = data.filter((r) => r.inLong && !r.buySignal);
        break;
      case "FLAT":
        data = data.filter((r) => r.status === "FLAT");
        break;
      case "SIGNALS":
        data = data.filter((r) => r.buySignal || r.exitSignal);
        break;
      default:
        break;
    }

    const statusOrder: Record<string, number> = {
      BUY: 4,
      EXIT: 3,
      IN_LONG: 2,
      FLAT: 1,
    };

    data.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      switch (sortConfig.key) {
        case "status":
          valA = statusOrder[a.status] ?? 0;
          valB = statusOrder[b.status] ?? 0;
          break;
        case "ltp":
          valA = a.ltp;
          valB = b.ltp;
          break;
        case "changePct":
          valA = a.changePct;
          valB = b.changePct;
          break;
        case "pctAboveUpper":
          valA = a.pctAboveUpper ?? -9999;
          valB = b.pctAboveUpper ?? -9999;
          break;
        case "pctVsEma":
          valA = a.pctVsEma ?? -9999;
          valB = b.pctVsEma ?? -9999;
          break;
        case "rsi":
          valA = a.rsi ?? -9999;
          valB = b.rsi ?? -9999;
          break;
        case "symbol":
          valA = a.symbol;
          valB = b.symbol;
          break;
        case "ema":
          valA = a.ema ?? a.ema21 ?? -9999;
          valB = b.ema ?? b.ema21 ?? -9999;
          break;
        default: {
          const anyA = a as unknown as Record<string, number | string>;
          const anyB = b as unknown as Record<string, number | string>;
          valA = anyA[sortConfig.key] ?? 0;
          valB = anyB[sortConfig.key] ?? 0;
        }
      }

      if (valA < valB) return sortConfig.dir === "asc" ? -1 : 1;
      if (valA > valB) return sortConfig.dir === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  }, [results, searchTerm, signalFilter, sortConfig]);

  const toggleSort = (key: string) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
    );
  };

  const runScan = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setResults([]);
    setProgress({ done: 0, total: STOCKS.length });
    setSelectedStock(null);

    const mid = modeId(strategy, timeframe);
    const label = SCREENERS[mid].label;
    toast.info(`Scanning ${STOCKS.length} NSE stocks · ${label}`);

    let done = 0;
    const scanned = await runWithConcurrency(STOCKS, CONCURRENCY, async (sym) => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: sym,
            strategy,
            timeframe,
            modeId: mid,
          }),
        });
        if (!res.ok) {
          done++;
          setProgress({ done, total: STOCKS.length });
          return null;
        }
        const data: BaseScanResult = await res.json();
        done++;
        setProgress({ done, total: STOCKS.length });

        if (data.error && data.barsAnalyzed === 0) return null;

        const row: ScanResult = { ...data, scannedAt: new Date().toISOString() };
        setResults((prev) => {
          const next = [...prev.filter((p) => p.symbol !== row.symbol), row];
          return next;
        });
        return row;
      } catch {
        done++;
        setProgress({ done, total: STOCKS.length });
        return null;
      }
    });

    setLastScan(new Date());
    setIsScanning(false);

    const buys = scanned.filter((r) => r.buySignal).length;
    const exits = scanned.filter((r) => r.exitSignal).length;
    toast.success(
      `Scan complete · ${scanned.length} stocks · ${buys} BUY · ${exits} EXIT`
    );
  }, [isScanning, strategy, timeframe]);

  const exportCsv = () => {
    if (!filteredResults.length) {
      toast.error("No rows to export");
      return;
    }
    const headers = [
      "Symbol",
      "Name",
      "Strategy",
      "Timeframe",
      "Status",
      "LTP",
      "Change%",
      "LastClose",
      "EMA",
      "EMA21",
      "RSI",
      "BB_Basis",
      "BB_Upper",
      "BB_Lower",
      "PctAboveUpper",
      "PctVsEma",
      "BuySignal",
      "ExitSignal",
      "InLong",
      "LastDate",
    ];
    const rows = filteredResults.map((r) =>
      [
        r.symbol,
        `"${r.name.replace(/"/g, '""')}"`,
        r.strategy,
        r.timeframe,
        r.status,
        r.ltp,
        r.changePct,
        r.lastClose,
        r.ema ?? "",
        r.ema21 ?? "",
        r.rsi ?? "",
        r.bbBasis ?? "",
        r.bbUpper ?? "",
        r.bbLower ?? "",
        r.pctAboveUpper ?? "",
        r.pctVsEma ?? "",
        r.buySignal ? 1 : 0,
        r.exitSignal ? 1 : 0,
        r.inLong ? 1 : 0,
        r.lastDate,
      ].join(",")
    );
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scanner-${activeModeId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  // Chart data for selected stock
  const chartData = useMemo(() => {
    if (!selectedStock?.recentCandles?.length) return [];

    // RSI chart: plot RSI history with levels
    if (selectedStock.kind === "rsi" && selectedStock.rsiHistory?.length) {
      return selectedStock.rsiHistory.map((h) => ({
        date: h.date.slice(5),
        rsi: h.rsi ?? undefined,
        level70: 70,
        level55: 55,
        level30: 30,
        level10: 10,
        level90: 90,
      }));
    }

    // BB chart
    if (cfg.strategy !== "bb") return [];
    const bbCfg = cfg as BbScreenerConfig;
    const closes = selectedStock.recentCandles.map((c) => c.close);
    const bbLen = bbCfg.bbLength;
    const bbMult = bbCfg.bbMult;
    const emaLen = bbCfg.emaLen;

    const emaArr: (number | null)[] = [];
    const k = 2 / (emaLen + 1);
    let ema = NaN;
    let seed = 0;
    let seedN = 0;
    for (let i = 0; i < closes.length; i++) {
      const v = closes[i];
      if (isNaN(ema)) {
        seed += v;
        seedN++;
        if (seedN >= emaLen) {
          ema = seed / seedN;
          emaArr.push(ema);
        } else {
          emaArr.push(null);
        }
      } else {
        ema = v * k + ema * (1 - k);
        emaArr.push(ema);
      }
    }

    const upperArr: (number | null)[] = [];
    const lowerArr: (number | null)[] = [];
    const basisArr: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < bbLen - 1 || emaArr[i] == null) {
        upperArr.push(null);
        lowerArr.push(null);
        basisArr.push(null);
        continue;
      }
      const window: number[] = [];
      for (let j = i - bbLen + 1; j <= i; j++) {
        if (emaArr[j] != null) window.push(emaArr[j]!);
      }
      if (window.length < bbLen) {
        upperArr.push(null);
        lowerArr.push(null);
        basisArr.push(null);
        continue;
      }
      const mean = window.reduce((a, b) => a + b, 0) / bbLen;
      let variance = 0;
      for (const x of window) variance += (x - mean) ** 2;
      const std = Math.sqrt(variance / bbLen);
      basisArr.push(mean);
      upperArr.push(mean + bbMult * std);
      lowerArr.push(mean - bbMult * std);
    }

    return selectedStock.recentCandles.map((c, i) => ({
      date: c.date.slice(5),
      close: c.close,
      ema: emaArr[i] != null ? Number(emaArr[i]!.toFixed(2)) : undefined,
      upper: upperArr[i] != null ? Number(upperArr[i]!.toFixed(2)) : undefined,
      lower: lowerArr[i] != null ? Number(lowerArr[i]!.toFixed(2)) : undefined,
      basis: basisArr[i] != null ? Number(basisArr[i]!.toFixed(2)) : undefined,
    }));
  }, [selectedStock, cfg]);

  return (
    <div className="min-h-screen bg-grid">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#1c2433] bg-[#07090f]/90 backdrop-blur-md">
        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-blue-500/10 p-2.5 ring-1 ring-blue-500/30">
                <Layers className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  NSE Multi-Screener
                </h1>
                <p className="mt-0.5 text-sm text-[#8b95a8]">
                  BB(on EMA) + RSI · Indian stocks via Yahoo Finance
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Strategy toggle */}
              <div className="flex rounded-xl border border-[#1c2433] bg-[#0d111a] p-1">
                {(["bb", "rsi70", "rsi10"] as Strategy[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isScanning}
                    onClick={() => {
                      setStrategy(s);
                      resetScanState();
                    }}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
                      strategy === s
                        ? s === "bb"
                          ? "bg-blue-600 text-white shadow"
                          : s === "rsi70"
                            ? "bg-violet-600 text-white shadow"
                            : "bg-amber-600 text-white shadow"
                        : "text-[#8b95a8] hover:text-white"
                    } disabled:opacity-50`}
                  >
                    {STRATEGY_META[s].short}
                  </button>
                ))}
              </div>

              {/* Timeframe toggle */}
              <div className="flex rounded-xl border border-[#1c2433] bg-[#0d111a] p-1">
                {(["weekly", "daily"] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    disabled={isScanning}
                    onClick={() => {
                      setTimeframe(tf);
                      resetScanState();
                    }}
                    className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                      timeframe === tf
                        ? "bg-slate-600 text-white shadow"
                        : "text-[#8b95a8] hover:text-white"
                    } disabled:opacity-50`}
                  >
                    {tf === "weekly" ? "Weekly" : "Daily"}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={runScan}
                disabled={isScanning}
                className="inline-flex items-center gap-2 rounded-xl bg-lime-500 px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-lime-500/20 transition hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isScanning ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isScanning ? "Scanning…" : "Run Scan"}
              </button>

              <button
                type="button"
                onClick={exportCsv}
                disabled={!results.length}
                className="inline-flex items-center gap-2 rounded-xl border border-[#1c2433] bg-[#0d111a] px-3 py-2 text-sm text-[#8b95a8] transition hover:border-[#334155] hover:text-white disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                CSV
              </button>
            </div>
          </div>

          {/* Config strip */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#8b95a8]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
              <Target className="h-3 w-3 text-blue-400" />
              {cfg.label}
            </span>
            {isBb ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
                  <BarChart3 className="h-3 w-3 text-orange-400" />
                  EMA({(cfg as BbScreenerConfig).emaLen}) → BB(
                  {(cfg as BbScreenerConfig).bbLength},{" "}
                  {(cfg as BbScreenerConfig).bbMult})
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
                  <Activity className="h-3 w-3 text-lime-400" />
                  Entry: close &gt; upper &amp; EMA
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
                  <BarChart3 className="h-3 w-3 text-violet-400" />
                  RSI({(cfg as RsiScreenerConfig).rsiLength}) on EMA(
                  {(cfg as RsiScreenerConfig).sourceEmaLen})
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
                  <Activity className="h-3 w-3 text-lime-400" />
                  {strategy === "rsi70"
                    ? "BUY: fresh cross ↑70 · EXIT: ↑90 or ↓55"
                    : "BUY: fresh cross ↑10 · EXIT: ↓10"}
                </span>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
              Universe: {universeSize} NSE
            </span>
            {lastScan && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c2433] bg-[#0d111a] px-2.5 py-1">
                <Clock className="h-3 w-3" />
                {lastScan.toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Progress */}
          {isScanning && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-[#8b95a8] mb-1">
                <span>Fetching & analyzing…</span>
                <span>
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#1c2433]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-lime-400 transition-all duration-300"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* KPI cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <KpiCard
            label="Scanned"
            value={counts.total}
            accent="text-white"
            active={signalFilter === "ALL"}
            onClick={() => setSignalFilter("ALL")}
          />
          <KpiCard
            label="BUY signals"
            value={counts.buy}
            accent="text-lime-400"
            active={signalFilter === "BUY"}
            onClick={() => setSignalFilter("BUY")}
          />
          <KpiCard
            label="EXIT signals"
            value={counts.exit}
            accent="text-fuchsia-400"
            active={signalFilter === "EXIT"}
            onClick={() => setSignalFilter("EXIT")}
          />
          <KpiCard
            label="In Long"
            value={counts.inLong}
            accent="text-cyan-400"
            active={signalFilter === "IN_LONG"}
            onClick={() => setSignalFilter("IN_LONG")}
          />
          <KpiCard
            label="Flat"
            value={counts.flat}
            accent="text-zinc-400"
            active={signalFilter === "FLAT"}
            onClick={() => setSignalFilter("FLAT")}
            className="col-span-2 sm:col-span-1"
          />
        </div>

        {/* Filters row */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b95a8]" />
            <input
              type="text"
              placeholder="Search symbol or name…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-[#1c2433] bg-[#0d111a] py-2 pl-10 pr-9 text-sm text-white placeholder:text-[#5a6478] outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8b95a8] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["SIGNALS", "Buy + Exit"],
                ["ALL", "All"],
                ["BUY", "Buy only"],
                ["EXIT", "Exit only"],
                ["IN_LONG", "In long"],
              ] as [SignalFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSignalFilter(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  signalFilter === key
                    ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/40"
                    : "bg-[#0d111a] text-[#8b95a8] ring-1 ring-[#1c2433] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-[#1c2433] bg-[#0d111a]/80">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#1c2433] text-xs uppercase tracking-wide text-[#8b95a8]">
                  <Th onClick={() => toggleSort("symbol")} active={sortConfig.key === "symbol"}>
                    Symbol
                  </Th>
                  <Th onClick={() => toggleSort("status")} active={sortConfig.key === "status"}>
                    Status
                  </Th>
                  <Th onClick={() => toggleSort("ltp")} active={sortConfig.key === "ltp"} align="right">
                    LTP
                  </Th>
                  <Th
                    onClick={() => toggleSort("changePct")}
                    active={sortConfig.key === "changePct"}
                    align="right"
                  >
                    Chg %
                  </Th>
                  {isBb ? (
                    <>
                      <Th onClick={() => toggleSort("ema")} active={sortConfig.key === "ema"} align="right">
                        EMA
                      </Th>
                      <th className="px-3 py-3 font-medium text-right">BB Upper</th>
                      <th className="px-3 py-3 font-medium text-right">BB Lower</th>
                      <Th
                        onClick={() => toggleSort("pctAboveUpper")}
                        active={sortConfig.key === "pctAboveUpper"}
                        align="right"
                      >
                        vs Upper
                      </Th>
                      <Th
                        onClick={() => toggleSort("pctVsEma")}
                        active={sortConfig.key === "pctVsEma"}
                        align="right"
                      >
                        vs EMA
                      </Th>
                    </>
                  ) : (
                    <>
                      <Th onClick={() => toggleSort("rsi")} active={sortConfig.key === "rsi"} align="right">
                        RSI
                      </Th>
                      <th className="px-3 py-3 font-medium text-right">Prev RSI</th>
                      <th className="px-3 py-3 font-medium text-right">EMA(21)</th>
                      <th className="px-3 py-3 font-medium text-right">Δ RSI</th>
                    </>
                  )}
                  <th className="px-3 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.length === 0 ? (
                  <tr>
                    <td colSpan={isBb ? 10 : 9} className="px-4 py-16 text-center text-[#8b95a8]">
                      {isScanning ? (
                        <span className="inline-flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Scanning universe…
                        </span>
                      ) : results.length === 0 ? (
                        <div className="space-y-2">
                          <TrendingUp className="mx-auto h-8 w-8 opacity-40" />
                          <p>Hit <strong className="text-white">Run Scan</strong> to screen NSE stocks</p>
                          <p className="text-xs">{cfg.label}</p>
                        </div>
                      ) : (
                        "No rows match current filters"
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredResults.map((r) => (
                    <tr
                      key={r.symbol}
                      onClick={() => setSelectedStock(r)}
                      className="cursor-pointer border-b border-[#1c2433]/60 transition hover:bg-white/[0.03]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white">{r.symbol}</div>
                        <div className="max-w-[160px] truncate text-xs text-[#8b95a8]">
                          {r.name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${statusColor(r.status)}`}
                        >
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-white">
                        {formatINR(r.ltp)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono ${
                          r.changePct > 0
                            ? "text-lime-400"
                            : r.changePct < 0
                              ? "text-red-400"
                              : "text-[#8b95a8]"
                        }`}
                      >
                        {formatPercent(r.changePct)}
                      </td>
                      {isBb ? (
                        <>
                          <td className="px-3 py-2.5 text-right font-mono text-orange-300/90">
                            {r.ema != null ? r.ema.toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-green-400/80">
                            {r.bbUpper != null ? r.bbUpper.toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-red-400/80">
                            {r.bbLower != null ? r.bbLower.toFixed(2) : "—"}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono ${
                              (r.pctAboveUpper ?? 0) > 0 ? "text-lime-400" : "text-[#8b95a8]"
                            }`}
                          >
                            {formatPercent(r.pctAboveUpper)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono ${
                              (r.pctVsEma ?? 0) > 0 ? "text-cyan-400" : "text-[#8b95a8]"
                            }`}
                          >
                            {formatPercent(r.pctVsEma)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-semibold ${
                              (r.rsi ?? 0) >= 70
                                ? "text-lime-400"
                                : (r.rsi ?? 0) <= 30
                                  ? "text-red-400"
                                  : "text-violet-300"
                            }`}
                          >
                            {r.rsi != null ? r.rsi.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#8b95a8]">
                            {r.prevRsi != null ? r.prevRsi.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-orange-300/90">
                            {r.ema21 != null ? r.ema21.toFixed(2) : "—"}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono ${
                              r.rsi != null && r.prevRsi != null
                                ? r.rsi - r.prevRsi > 0
                                  ? "text-lime-400"
                                  : "text-red-400"
                                : "text-[#8b95a8]"
                            }`}
                          >
                            {r.rsi != null && r.prevRsi != null
                              ? `${r.rsi - r.prevRsi > 0 ? "+" : ""}${(r.rsi - r.prevRsi).toFixed(1)}`
                              : "—"}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2.5 text-xs text-[#8b95a8]">{r.lastDate}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredResults.length > 0 && (
            <div className="border-t border-[#1c2433] px-4 py-2 text-xs text-[#8b95a8]">
              Showing {filteredResults.length} of {results.length} · Click row for chart
            </div>
          )}
        </div>

        {/* Logic reference */}
        <div className="mt-8 rounded-2xl border border-[#1c2433] bg-[#0d111a]/60 p-5 text-sm text-[#8b95a8]">
          <h2 className="mb-2 font-medium text-white">Signal logic (from PineScript)</h2>
          {isBb ? (
            <ul className="list-inside list-disc space-y-1 text-xs sm:text-sm">
              <li>
                <code className="text-orange-300">EMA</code> on close · length{" "}
                <strong className="text-white">{(cfg as BbScreenerConfig).emaLen}</strong>
              </li>
              <li>
                Bollinger Bands on the <strong className="text-white">EMA series</strong>: SMA(
                {(cfg as BbScreenerConfig).bbLength}) ± {(cfg as BbScreenerConfig).bbMult} × StdDev
              </li>
              <li>
                <span className="text-lime-400 font-medium">BUY</span>: close &gt; upper BB{" "}
                <em>and</em> close &gt; EMA · one-shot
              </li>
              <li>
                <span className="text-fuchsia-400 font-medium">EXIT</span>: close &lt; lower BB
              </li>
            </ul>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-xs sm:text-sm">
              <li>
                RSI <strong className="text-white">source</strong> ={" "}
                <code className="text-orange-300">EMA(close, 21)</code> (not raw close)
              </li>
              <li>
                RSI length = <strong className="text-white">10</strong> · Wilder RMA of gains/losses
              </li>
              {strategy === "rsi70" ? (
                <>
                  <li>
                    <span className="text-lime-400 font-medium">BUY</span>: fresh RSI cross{" "}
                    <strong className="text-white">above 70</strong>
                  </li>
                  <li>
                    <span className="text-fuchsia-400 font-medium">EXIT</span>: fresh cross{" "}
                    <strong className="text-white">above 90</strong> or falls{" "}
                    <strong className="text-white">below 55</strong>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <span className="text-lime-400 font-medium">BUY</span>: fresh RSI cross{" "}
                    <strong className="text-white">above 10</strong> (recovery)
                  </li>
                  <li>
                    <span className="text-fuchsia-400 font-medium">EXIT</span>: fresh cross back{" "}
                    <strong className="text-white">below 10</strong>
                  </li>
                </>
              )}
              <li>All signals are <strong className="text-white">fresh crosses only</strong> (one-shot)</li>
            </ul>
          )}
          <p className="mt-2 text-xs">
            Timeframe:{" "}
            <strong className="text-white">
              {timeframe === "weekly" ? "weekly candle close" : "daily candle close"}
            </strong>
          </p>
        </div>
      </main>

      {/* Detail modal */}
      <AnimatePresence>
        {selectedStock && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
            onClick={() => setSelectedStock(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-[#1c2433] bg-[#0d111a] sm:rounded-2xl"
            >
              <div className="sticky top-0 flex items-start justify-between border-b border-[#1c2433] bg-[#0d111a]/95 px-5 py-4 backdrop-blur">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-white">
                      {selectedStock.symbol}
                    </h3>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${statusColor(selectedStock.status)}`}
                    >
                      {statusLabel(selectedStock.status)}
                    </span>
                  </div>
                  <p className="text-sm text-[#8b95a8]">{selectedStock.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStock(null)}
                  className="rounded-lg p-1.5 text-[#8b95a8] hover:bg-white/5 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
                <Stat label="LTP" value={formatINR(selectedStock.ltp)} />
                <Stat
                  label="Change"
                  value={formatPercent(selectedStock.changePct)}
                  color={
                    selectedStock.changePct > 0
                      ? "text-lime-400"
                      : selectedStock.changePct < 0
                        ? "text-red-400"
                        : undefined
                  }
                />
                {selectedStock.kind === "rsi" ? (
                  <>
                    <Stat
                      label="RSI"
                      value={selectedStock.rsi?.toFixed(2) ?? "—"}
                      color="text-violet-300"
                    />
                    <Stat
                      label="Prev RSI"
                      value={selectedStock.prevRsi?.toFixed(2) ?? "—"}
                    />
                    <Stat
                      label="EMA(21) src"
                      value={selectedStock.ema21?.toFixed(2) ?? "—"}
                      color="text-orange-300"
                    />
                    <Stat label="Last bar" value={selectedStock.lastDate} />
                    <Stat label="Close" value={selectedStock.lastClose.toFixed(2)} />
                    <Stat
                      label="Mode"
                      value={
                        selectedStock.strategy === "rsi70" ? "Cross 70" : "Cross 10"
                      }
                    />
                  </>
                ) : (
                  <>
                    <Stat
                      label={`EMA(${(cfg as BbScreenerConfig).emaLen})`}
                      value={selectedStock.ema?.toFixed(2) ?? "—"}
                      color="text-orange-300"
                    />
                    <Stat label="Last bar" value={selectedStock.lastDate} />
                    <Stat
                      label="BB Upper"
                      value={selectedStock.bbUpper?.toFixed(2) ?? "—"}
                      color="text-green-400"
                    />
                    <Stat
                      label="BB Basis"
                      value={selectedStock.bbBasis?.toFixed(2) ?? "—"}
                      color="text-blue-400"
                    />
                    <Stat
                      label="BB Lower"
                      value={selectedStock.bbLower?.toFixed(2) ?? "—"}
                      color="text-red-400"
                    />
                    <Stat
                      label="Close"
                      value={selectedStock.lastClose.toFixed(2)}
                    />
                  </>
                )}
              </div>

              {chartData.length > 0 && (
                <div className="px-5 pb-2">
                  <p className="mb-2 text-xs text-[#8b95a8]">
                    {selectedStock.kind === "rsi"
                      ? `RSI(10 on EMA21) · last ${chartData.length} bars`
                      : `Price · EMA · BB (on EMA) · last ${chartData.length} bars`}
                  </p>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData as Record<string, string | number | undefined>[]}>
                        <CartesianGrid stroke="#1c2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#8b95a8", fontSize: 10 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          domain={
                            selectedStock.kind === "rsi" ? [0, 100] : ["auto", "auto"]
                          }
                          tick={{ fill: "#8b95a8", fontSize: 10 }}
                          width={56}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#0d111a",
                            border: "1px solid #1c2433",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        {selectedStock.kind === "rsi" ? (
                          <>
                            <ReferenceLine y={70} stroke="#84cc16" strokeDasharray="3 3" />
                            <ReferenceLine y={55} stroke="#f59e0b" strokeDasharray="3 3" />
                            <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="3 3" />
                            <ReferenceLine y={10} stroke="#f472b6" strokeDasharray="3 3" />
                            <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="2 2" />
                            <Line
                              type="monotone"
                              dataKey="rsi"
                              stroke="#a78bfa"
                              dot={false}
                              strokeWidth={2}
                              name="RSI"
                            />
                          </>
                        ) : (
                          <>
                            <Line
                              type="monotone"
                              dataKey="upper"
                              stroke="#22c55e"
                              dot={false}
                              strokeWidth={1}
                              name="Upper"
                            />
                            <Line
                              type="monotone"
                              dataKey="lower"
                              stroke="#ef4444"
                              dot={false}
                              strokeWidth={1}
                              name="Lower"
                            />
                            <Line
                              type="monotone"
                              dataKey="basis"
                              stroke="#3b82f6"
                              dot={false}
                              strokeWidth={1}
                              strokeDasharray="4 2"
                              name="Basis"
                            />
                            <Line
                              type="monotone"
                              dataKey="ema"
                              stroke="#f97316"
                              dot={false}
                              strokeWidth={1.5}
                              name="EMA"
                            />
                            <Line
                              type="monotone"
                              dataKey="close"
                              stroke="#e2e8f0"
                              dot={false}
                              strokeWidth={2}
                              name="Close"
                            />
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="border-t border-[#1c2433] p-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8b95a8]">
                  Analysis
                </p>
                <ul className="space-y-1.5 text-sm text-[#c4cad6]">
                  {selectedStock.reasons.map((reason, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-blue-400">•</span>
                      {reason}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Flag on={selectedStock.buySignal} label="Buy signal" onClass="text-lime-400" />
                  <Flag on={selectedStock.exitSignal} label="Exit signal" onClass="text-fuchsia-400" />
                  <Flag on={selectedStock.inLong} label="In long" onClass="text-cyan-400" />
                  <Flag on={selectedStock.entryCond} label="Entry cond" onClass="text-green-400" />
                  <Flag on={selectedStock.exitCond} label="Exit cond" onClass="text-red-400" />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  active,
  onClick,
  className = "",
}: {
  label: string;
  value: number;
  accent: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? "border-blue-500/40 bg-blue-500/10"
          : "border-[#1c2433] bg-[#0d111a]/80 hover:border-[#334155]"
      } ${className}`}
    >
      <div className="text-xs text-[#8b95a8]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
    </button>
  );
}

function Th({
  children,
  onClick,
  active,
  align = "left",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer px-3 py-3 font-medium transition hover:text-white ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-blue-400" : ""}`}
    >
      {children}
    </th>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-[#1c2433] bg-[#07090f]/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#8b95a8]">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-medium ${color || "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

function Flag({
  on,
  label,
  onClass,
}: {
  on: boolean;
  label: string;
  onClass: string;
}) {
  return (
    <span
      className={`rounded-md border px-2 py-1 ${
        on
          ? `border-current/30 bg-current/10 ${onClass}`
          : "border-[#1c2433] text-[#5a6478]"
      }`}
    >
      {label}: {on ? "YES" : "no"}
    </span>
  );
}
