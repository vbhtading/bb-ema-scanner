export function formatINR(n: number): string {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}

export function formatNumber(n: number): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e7) return (n / 1e7).toFixed(1) + "Cr";
  if (n >= 1e5) return (n / 1e5).toFixed(1) + "L";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;

  const runners = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const current = i++;
        const res = await worker(items[current]);
        if (res !== null) results.push(res);
      }
    });

  await Promise.all(runners);
  return results;
}

export function statusColor(status: string): string {
  switch (status) {
    case "BUY":
      return "bg-lime-500/15 text-lime-400 border-lime-500/40";
    case "EXIT":
      return "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/40";
    case "IN_LONG":
      return "bg-cyan-500/15 text-cyan-400 border-cyan-500/40";
    default:
      return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "BUY":
      return "BUY";
    case "EXIT":
      return "EXIT";
    case "IN_LONG":
      return "IN LONG";
    default:
      return "FLAT";
  }
}
