import type { Factor, FactorReading, Point, ReadingStatus } from "../types.js";

export type Fetcher = (factor: Factor) => Promise<FactorReading>;

export function reading(factor: Factor, patch: Partial<FactorReading>): FactorReading {
  return {
    id: factor.id,
    slug: factor.slug,
    nameHe: factor.nameHe,
    nameEn: factor.nameEn,
    weightPercent: factor.weightPercent,
    group: factor.group,
    citedSource: factor.citedSource,
    liveSource: factor.liveSource,
    requiresEnv: factor.requiresEnv ?? null,
    status: "ok",
    asOf: null,
    value: null,
    unit: null,
    change: null,
    changeUnit: null,
    series: [],
    detail: {},
    fetchedFrom: null,
    summary: null,
    note: null,
    ...patch,
  };
}

export function unavailable(factor: Factor, envName: string, why: string): FactorReading {
  return reading(factor, {
    status: "unavailable",
    note: `${why} Set ${envName} and call this factor again.`,
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function tail<T>(items: T[], count: number): T[] {
  return items.slice(Math.max(0, items.length - count));
}

export function pointsFrom(pairs: Point[]): Point[] {
  return pairs.filter((point) => Number.isFinite(point.value));
}

export function yearOverYear(points: Point[]): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  if (!latest || latest.value === 0) return null;
  const latestDate = new Date(latest.time);
  if (Number.isNaN(latestDate.getTime())) return null;
  const target = Date.UTC(latestDate.getUTCFullYear() - 1, latestDate.getUTCMonth(), latestDate.getUTCDate());
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const time = new Date(point.time).getTime();
    if (Number.isNaN(time)) continue;
    const distance = Math.abs(time - target);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  if (!best || best.value === 0 || bestDistance > 45 * 24 * 60 * 60 * 1000) return null;
  return ((latest.value / best.value) - 1) * 100;
}

export function monthOverMonth(points: Point[]): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest || !previous || previous.value === 0) return null;
  return ((latest.value / previous.value) - 1) * 100;
}

export function numericStatus(value: number | null): ReadingStatus {
  return value === null || !Number.isFinite(value) ? "error" : "ok";
}
