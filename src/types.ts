export const GROUP_IDS = [
  "liquidity",
  "risk",
  "crypto",
  "derivatives",
  "onchain",
  "economy",
  "events",
] as const;

export type GroupId = (typeof GROUP_IDS)[number];

export const GROUP_LABELS: Record<GroupId, string> = {
  liquidity: "Dollar, rates, and liquidity",
  risk: "Equities, volatility, and commodities",
  crypto: "Crypto spot, flows, and dominance",
  derivatives: "Derivatives and positioning",
  onchain: "Bitcoin on-chain",
  economy: "Inflation, jobs, and global economy",
  events: "Geopolitics, regulation, and security",
};

export interface Factor {
  id: number;
  slug: string;
  nameHe: string;
  nameEn: string;
  weightPercent: number;
  citedSource: string;
  group: GroupId;
  /** Where the live number is actually read from. */
  liveSource: string;
  /** Env var required before this factor can return data. */
  requiresEnv?: string;
}

export interface Point {
  time: string;
  value: number;
}

export type ReadingStatus = "ok" | "unavailable" | "error";

export interface FactorReading {
  id: number;
  slug: string;
  nameHe: string;
  nameEn: string;
  weightPercent: number;
  group: GroupId;
  citedSource: string;
  liveSource: string;
  requiresEnv: string | null;
  status: ReadingStatus;
  asOf: string | null;
  value: number | null;
  unit: string | null;
  change: number | null;
  changeUnit: string | null;
  series: Point[];
  detail: Record<string, unknown>;
  fetchedFrom: string | null;
  summary: string | null;
  note: string | null;
}
