import type { Point } from "./types.js";

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

export function parseFlowCell(raw: string): number | null {
  const text = raw.replace(/,/g, "").trim();
  if (!text || text === "-" || text === "—") return null;
  const negative = text.match(/^\(([\d.]+)\)$/);
  if (negative) return -Number(negative[1]);
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export interface YahooQuote {
  price: number;
  time: string;
  previousClose: number | null;
  changePercent: number | null;
  currency: string | null;
  name: string | null;
  closes: Point[];
}

interface YahooPayload {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        chartPreviousClose?: number;
        currency?: string;
        shortName?: string;
        longName?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { description?: string } | null;
  };
}

export function parseYahooChart(payload: unknown): YahooQuote {
  const chart = payload as YahooPayload;
  const error = chart.chart?.error?.description;
  const result = chart.chart?.result?.[0];
  if (!result?.meta || typeof result.meta.regularMarketPrice !== "number") {
    throw new Error(error || "Yahoo chart returned no price");
  }
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const series: Point[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = closes[index];
    const timestamp = timestamps[index];
    if (typeof close === "number" && Number.isFinite(close) && typeof timestamp === "number") {
      series.push({ time: new Date(timestamp * 1000).toISOString(), value: close });
    }
  }
  const previousClose = typeof result.meta.chartPreviousClose === "number" ? result.meta.chartPreviousClose : null;
  const changePercent =
    previousClose && previousClose !== 0
      ? ((result.meta.regularMarketPrice - previousClose) / previousClose) * 100
      : null;
  return {
    price: result.meta.regularMarketPrice,
    time: new Date((result.meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    previousClose,
    changePercent,
    currency: result.meta.currency ?? null,
    name: result.meta.longName ?? result.meta.shortName ?? null,
    closes: series.slice(-10),
  };
}

const YIELD_FIELDS: Record<string, string> = {
  BC_1MONTH: "1M",
  BC_3MONTH: "3M",
  BC_6MONTH: "6M",
  BC_1YEAR: "1Y",
  BC_2YEAR: "2Y",
  BC_3YEAR: "3Y",
  BC_5YEAR: "5Y",
  BC_7YEAR: "7Y",
  BC_10YEAR: "10Y",
  BC_20YEAR: "20Y",
  BC_30YEAR: "30Y",
};

export interface YieldCurve {
  date: string;
  yields: Record<string, number>;
}

export function parseTreasuryCurves(xml: string): YieldCurve[] {
  const blocks = xml.split("<m:properties>").slice(1);
  const curves: YieldCurve[] = [];
  for (const block of blocks) {
    const body = block.split("</m:properties>")[0] ?? "";
    const date = prop(body, "NEW_DATE")?.slice(0, 10);
    if (!date) continue;
    const yields: Record<string, number> = {};
    for (const [field, label] of Object.entries(YIELD_FIELDS)) {
      const raw = prop(body, field);
      if (!raw) continue;
      const value = Number(raw);
      if (Number.isFinite(value)) yields[label] = value;
    }
    if (Object.keys(yields).length > 0) curves.push({ date, yields });
  }
  return curves;
}

function prop(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<d:${name}[^>]*>([^<]*)</d:${name}>`));
  return match?.[1]?.trim() || null;
}

export interface EtfFlowRow {
  date: string;
  total: number | null;
  issuers: Record<string, number | null>;
}

export function parseFarsideFlows(html: string): EtfFlowRow[] {
  const tableStart = html.indexOf('<table class="etf"');
  const table = tableStart >= 0 ? html.slice(tableStart).split("</table>")[0] ?? "" : html;
  const head = table.split("</thead>")[0] ?? "";
  const headerRow = [...head.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((match) => cells(match[0]))
    .find((row) => row.some((cell) => cell.toLowerCase() === "total"));
  const headers = headerRow?.map((cell, index) => cell || (index === 0 ? "date" : `col${index}`)) ?? [];
  const totalIndex = headers.findIndex((cell) => cell.toLowerCase() === "total");
  const body = table.split("<tbody")[1]?.split("</tbody>")[0] ?? "";
  const rows: EtfFlowRow[] = [];
  for (const match of body.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const values = cells(match[0]);
    if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(values[0] ?? "")) continue;
    const issuers: Record<string, number | null> = {};
    headers.forEach((header, index) => {
      if (index === 0 || header.toLowerCase() === "total") return;
      issuers[header] = parseFlowCell(values[index] ?? "");
    });
    const totalCell = totalIndex >= 0 ? values[totalIndex] : values[values.length - 1];
    rows.push({ date: values[0] ?? "", total: parseFlowCell(totalCell ?? ""), issuers });
  }
  return rows;
}

function cells(row: string): string[] {
  return [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripTags(match[1] ?? ""));
}

export interface UraniumRow {
  date: string;
  spot: number | null;
  longTerm: number | null;
}

export function parseCamecoPrices(html: string): UraniumRow[] {
  const rows: UraniumRow[] = [];
  for (const match of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const row = match[0];
    if (!row.includes("views-field-field-spot-price")) continue;
    const date = camecoCell(row, "field-monthly-date");
    const spot = parseFlowCell(camecoCell(row, "field-spot-price") ?? "");
    const longTerm = parseFlowCell(camecoCell(row, "field-long-term-price") ?? "");
    if (date) rows.push({ date: date.replaceAll("/", "-"), spot, longTerm });
  }
  return rows;
}

function camecoCell(row: string, className: string): string | null {
  const match = row.match(new RegExp(`views-field-${className}[^"]*"[^>]*>([\\s\\S]*?)</td>`, "i"));
  return match?.[1] ? stripTags(match[1]) : null;
}

export function parseFredCsv(csv: string): Point[] {
  const lines = csv.trim().split(/\r?\n/).slice(1);
  const points: Point[] = [];
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!date || !raw || raw.trim() === ".") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) points.push({ time: date.trim(), value });
  }
  return points;
}

export interface BisObservation {
  period: string;
  value: number;
  unitMult: number;
  title: string;
}

export function parseBisCsv(csv: string): BisObservation[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = splitCsv(lines[0] ?? "");
  const periodIndex = header.indexOf("TIME_PERIOD");
  const valueIndex = header.indexOf("OBS_VALUE");
  const unitIndex = header.indexOf("UNIT_MULT");
  const titleIndex = header.indexOf("TITLE");
  const rows: BisObservation[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const columns = splitCsv(line);
    const value = Number(columns[valueIndex]);
    const unitMult = Number(columns[unitIndex]);
    const period = columns[periodIndex];
    if (!period || !Number.isFinite(value)) continue;
    rows.push({
      period,
      value,
      unitMult: Number.isFinite(unitMult) ? unitMult : 0,
      title: columns[titleIndex] ?? "",
    });
  }
  return rows;
}

function splitCsv(line: string): string[] {
  const columns: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      columns.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  columns.push(current);
  return columns;
}

export interface RssItem {
  title: string;
  link: string;
  date: string;
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? "";
    const title = stripTags(tag(block, "title"));
    if (!title) continue;
    items.push({
      title,
      link: stripTags(tag(block, "link")),
      date: stripTags(tag(block, "pubDate")),
    });
  }
  return items;
}

function tag(block: string, name: string): string {
  return block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";
}

export interface BlsPoint {
  seriesId: string;
  time: string;
  value: number;
}

interface BlsPayload {
  status?: string;
  message?: string[];
  Results?: {
    series?: Array<{
      seriesID?: string;
      data?: Array<{ year?: string; period?: string; value?: string }>;
    }>;
  };
}

export function parseBls(payload: unknown): BlsPoint[] {
  const body = payload as BlsPayload;
  if (body.status && body.status !== "REQUEST_SUCCEEDED") {
    throw new Error(body.message?.join(" ") || `BLS status ${body.status}`);
  }
  const points: BlsPoint[] = [];
  for (const series of body.Results?.series ?? []) {
    const seriesId = series.seriesID ?? "";
    const newestFirst = series.data ?? [];
    for (const row of newestFirst) {
      if (!row.period || !/^M(0[1-9]|1[0-2])$/.test(row.period) || !row.year) continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      points.push({ seriesId, time: `${row.year}-${row.period.slice(1)}-01`, value });
    }
  }
  return points.sort((a, b) => a.time.localeCompare(b.time));
}

export interface ChainChart {
  name: string;
  unit: string;
  points: Point[];
}

export function parseBlockchainChart(payload: unknown): ChainChart {
  const body = payload as { name?: string; unit?: string; values?: Array<{ x?: number; y?: number }> };
  const points = (body.values ?? [])
    .filter((row) => typeof row.x === "number" && typeof row.y === "number")
    .map((row) => ({ time: new Date((row.x as number) * 1000).toISOString(), value: row.y as number }));
  if (points.length === 0) throw new Error("Blockchain chart returned no values");
  return { name: body.name ?? "", unit: body.unit ?? "", points };
}
