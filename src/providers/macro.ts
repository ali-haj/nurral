import { envValue, getJson, getText, HttpError, round } from "../http.js";
import {
  parseBisCsv,
  parseBls,
  parseFredCsv,
  parseRssItems,
  type BlsPoint,
} from "../parse.js";
import type { Factor, FactorReading, Point } from "../types.js";
import { errorMessage, monthOverMonth, reading, tail, yearOverYear } from "./shared.js";

const CPI_SERIES = "CUUR0000SA0";
const UNEMPLOYMENT_SERIES = "LNS14000000";
const PAYROLL_SERIES = "CES0000000001";

let blsTask: Promise<BlsPoint[]> | null = null;

async function blsPoints(): Promise<BlsPoint[]> {
  if (!blsTask) {
    blsTask = requestBls().catch((error: unknown) => {
      blsTask = null;
      throw error;
    });
  }
  return blsTask;
}

async function requestBls(): Promise<BlsPoint[]> {
  const year = new Date().getUTCFullYear();
  const body = JSON.stringify({
    seriesid: [CPI_SERIES, UNEMPLOYMENT_SERIES, PAYROLL_SERIES],
    startyear: String(year - 2),
    endyear: String(year),
  });
  const key = envValue("BLS_API_KEY");
  const url = key
    ? "https://api.bls.gov/publicAPI/v2/timeseries/data/"
    : "https://api.bls.gov/publicAPI/v1/timeseries/data/";
  const payload = JSON.parse(body) as { registrationkey?: string };
  if (key) payload.registrationkey = key;
  const text = await getText(url, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json", accept: "application/json" },
    ttlMs: 6 * 60 * 60 * 1000,
  });
  if (text.trimStart().startsWith("<")) {
    throw new Error("BLS returned HTML instead of JSON. The public endpoint is often busy; set BLS_API_KEY or retry.");
  }
  return parseBls(JSON.parse(text));
}

function seriesPoints(points: BlsPoint[], seriesId: string): Point[] {
  return points.filter((point) => point.seriesId === seriesId).map(({ time, value }) => ({ time, value }));
}

export async function fredObservations(seriesId: string, limit: number): Promise<Point[]> {
  const key = envValue("FRED_API_KEY");
  if (key) {
    const url =
      "https://api.stlouisfed.org/fred/series/observations" +
      `?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}` +
      `&file_type=json&sort_order=desc&limit=${limit}`;
    const payload = await getJson<{ observations?: Array<{ date: string; value: string }>; error_message?: string }>(url);
    if (!payload.observations) throw new Error(payload.error_message ?? `FRED returned no data for ${seriesId}`);
    return payload.observations
      .filter((row) => row.value !== ".")
      .map((row) => ({ time: row.date, value: Number(row.value) }))
      .filter((point) => Number.isFinite(point.value))
      .reverse();
  }
  const csvUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const points = parseFredCsv(await getText(csvUrl, { ttlMs: 6 * 60 * 60 * 1000 }));
  if (points.length === 0) throw new Error(`FRED CSV for ${seriesId} was empty. Set FRED_API_KEY.`);
  return tail(points, limit);
}

export async function fetchCpi(factor: Factor): Promise<FactorReading> {
  try {
    const points = seriesPoints(await blsPoints(), CPI_SERIES);
    return inflationReading(factor, points, "BLS CPI-U, all items", "https://api.bls.gov/publicAPI/v1/timeseries/data/");
  } catch (error) {
    const points = await fredObservations("CPIAUCSL", 18);
    return inflationReading(
      factor,
      points,
      `FRED CPIAUCSL. BLS was unavailable: ${errorMessage(error)}`,
      "https://fred.stlouisfed.org/series/CPIAUCSL",
    );
  }
}

export async function fetchPce(factor: Factor): Promise<FactorReading> {
  const [headline, core] = await Promise.all([
    fredObservations("PCEPI", 18),
    fredObservations("PCEPILFE", 18).catch(() => [] as Point[]),
  ]);
  const readingResult = inflationReading(factor, headline, "BEA PCE price index via FRED PCEPI", "https://fred.stlouisfed.org/series/PCEPI");
  const coreYoy = yearOverYear(core);
  return reading(factor, {
    ...readingResult,
    detail: { ...readingResult.detail, corePceYoyPercent: coreYoy === null ? null : round(coreYoy, 2) },
  });
}

function inflationReading(factor: Factor, points: Point[], summaryPrefix: string, fetchedFrom: string): FactorReading {
  const latest = points[points.length - 1];
  if (!latest) throw new Error("No inflation observations");
  const yoy = yearOverYear(points);
  const mom = monthOverMonth(points);
  return reading(factor, {
    asOf: latest.time,
    value: yoy === null ? latest.value : round(yoy, 2),
    unit: yoy === null ? "index" : "percent, year over year",
    change: mom === null ? null : round(mom, 2),
    changeUnit: "percent, month over month",
    series: tail(points, 8),
    fetchedFrom,
    summary: yoy === null ? `${summaryPrefix} index ${round(latest.value, 2)}` : `${summaryPrefix} ${round(yoy, 2)}% YoY`,
    detail: { index: round(latest.value, 3) },
  });
}

export async function fetchEmployment(factor: Factor): Promise<FactorReading> {
  try {
    const points = await blsPoints();
    const unemployment = seriesPoints(points, UNEMPLOYMENT_SERIES);
    const payrolls = seriesPoints(points, PAYROLL_SERIES);
    return employmentReading(factor, unemployment, payrolls, "https://api.bls.gov/publicAPI/v1/timeseries/data/", null);
  } catch (error) {
    const [unemployment, payrolls] = await Promise.all([
      fredObservations("UNRATE", 8),
      fredObservations("PAYEMS", 8),
    ]);
    return employmentReading(factor, unemployment, payrolls, "https://fred.stlouisfed.org/series/UNRATE", errorMessage(error));
  }
}

function employmentReading(
  factor: Factor,
  unemployment: Point[],
  payrolls: Point[],
  fetchedFrom: string,
  blsError: string | null,
): FactorReading {
  const latestRate = unemployment[unemployment.length - 1];
  const previousRate = unemployment[unemployment.length - 2];
  const latestPayroll = payrolls[payrolls.length - 1];
  const previousPayroll = payrolls[payrolls.length - 2];
  if (!latestRate) throw new Error("No unemployment observations");
  const payrollChange =
    latestPayroll && previousPayroll ? round(latestPayroll.value - previousPayroll.value, 1) : null;
  return reading(factor, {
    asOf: latestRate.time,
    value: latestRate.value,
    unit: "percent, unemployment rate",
    change: previousRate ? round(latestRate.value - previousRate.value, 2) : null,
    changeUnit: "percentage points",
    series: tail(unemployment, 8),
    fetchedFrom,
    summary: `Unemployment ${latestRate.value}%${payrollChange === null ? "" : `, payrolls ${payrollChange > 0 ? "+" : ""}${payrollChange}k`}`,
    detail: {
      nonfarmPayrollsThousands: latestPayroll?.value ?? null,
      payrollChangeThousands: payrollChange,
      payrollAsOf: latestPayroll?.time ?? null,
    },
    note: blsError ? `BLS was unavailable (${blsError}). Values are from FRED.` : null,
  });
}

const BIS_LEVEL =
  "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_GLI/1.0/Q.USD.3P.N.A.I.B.USD?format=csvfile&lastNObservations=8";
const BIS_YOY =
  "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_GLI/1.0/Q.USD.3P.N.A.I.B.771?format=csvfile&lastNObservations=4";

export async function fetchGlobalLiquidity(factor: Factor): Promise<FactorReading> {
  const rows = parseBisCsv(await getText(BIS_LEVEL, { ttlMs: 12 * 60 * 60 * 1000 }));
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  if (!latest) throw new Error("BIS global liquidity response was empty");
  const toTrillions = (row: { value: number; unitMult: number }) => row.value * 10 ** row.unitMult / 1e12;
  const latestTrillions = toTrillions(latest);
  const previousTrillions = previous ? toTrillions(previous) : null;
  let yoy: number | null = null;
  try {
    const yoyRows = parseBisCsv(await getText(BIS_YOY, { ttlMs: 12 * 60 * 60 * 1000 }));
    yoy = yoyRows[yoyRows.length - 1]?.value ?? null;
  } catch {
    yoy = null;
  }
  return reading(factor, {
    asOf: latest.period,
    value: round(latestTrillions, 3),
    unit: "USD trillions",
    change: previousTrillions === null ? null : round(latestTrillions - previousTrillions, 3),
    changeUnit: "USD trillions, quarter",
    series: rows.map((row) => ({ time: row.period, value: round(toTrillions(row), 3) })),
    fetchedFrom: BIS_LEVEL,
    summary: `${latest.title} ${round(latestTrillions, 2)} trillion USD in ${latest.period}`,
    detail: { yoyPercent: yoy, unitMultiplier: latest.unitMult },
    note: "BIS USD-denominated credit to non-bank borrowers outside the United States. Quarterly, so the latest print lags the current month.",
  });
}

export async function fetchFedBalanceSheet(factor: Factor): Promise<FactorReading> {
  const points = await fredObservations("WALCL", 12);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest) throw new Error("No WALCL observations");
  const trillions = (value: number) => value / 1_000_000;
  return reading(factor, {
    asOf: latest.time,
    value: round(trillions(latest.value), 3),
    unit: "USD trillions, total assets",
    change: previous ? round(trillions(latest.value - previous.value), 3) : null,
    changeUnit: "USD trillions, week",
    series: points.map((point) => ({ time: point.time, value: round(trillions(point.value), 3) })),
    fetchedFrom: "https://fred.stlouisfed.org/series/WALCL",
    summary: `Fed total assets ${round(trillions(latest.value), 2)} trillion USD`,
    note: "WALCL is published in millions of USD and converted here to trillions.",
  });
}

export async function fetchBoj(factor: Factor): Promise<FactorReading> {
  const feedUrl = "https://www.boj.or.jp/en/rss/whatsnew.xml";
  const items = parseRssItems(await getText(feedUrl, { ttlMs: 30 * 60 * 1000 })).slice(0, 8);
  let rate: Point | null = null;
  let rateError: string | null = null;
  try {
    const points = await fredObservations("IRSTCI01JPM156N", 6);
    rate = points[points.length - 1] ?? null;
  } catch (error) {
    rateError = errorMessage(error);
  }
  return reading(factor, {
    asOf: rate?.time ?? items[0]?.date ?? null,
    value: rate?.value ?? null,
    unit: rate ? "percent, overnight call rate" : null,
    series: rate ? [{ time: rate.time, value: rate.value }] : [],
    fetchedFrom: rate ? "https://fred.stlouisfed.org/series/IRSTCI01JPM156N" : feedUrl,
    summary: items.slice(0, 3).map((item) => item.title).join(" | ") || "No recent Bank of Japan notices",
    detail: { notices: items },
    note: rate
      ? "The number is the FRED Japan call-money rate. The notices are the Bank of Japan's own feed."
      : `Latest Bank of Japan notices are included. The call rate needs a working FRED download${rateError ? ` (${rateError})` : ""}.`,
  });
}

interface WorldBankRow {
  date?: string;
  value?: number | null;
  indicator?: { value?: string };
}

export async function fetchChina(factor: Factor): Promise<FactorReading> {
  const [cpi, gdp] = await Promise.all([
    worldBank("FP.CPI.TOTL.ZG"),
    worldBank("NY.GDP.MKTP.KD.ZG"),
  ]);
  if (typeof cpi.value !== "number") throw new Error("World Bank returned no China CPI observation");
  return reading(factor, {
    asOf: cpi.date ?? null,
    value: round(cpi.value, 2),
    unit: "percent, annual CPI inflation",
    fetchedFrom: "https://api.worldbank.org/v2/country/CN/indicator/FP.CPI.TOTL.ZG?format=json&mrnev=1",
    summary: `China CPI ${round(cpi.value, 2)}% in ${cpi.date ?? "the latest year"}`,
    detail: {
      realGdpGrowthPercent: typeof gdp.value === "number" ? round(gdp.value, 2) : null,
      gdpYear: gdp.date ?? null,
    },
    note: "Annual World Bank series sourced from official statistics. China's NBS site does not offer a stable JSON API, so this print is not monthly.",
  });
}

async function worldBank(indicator: string): Promise<WorldBankRow> {
  const url = `https://api.worldbank.org/v2/country/CN/indicator/${indicator}?format=json&mrnev=1`;
  const payload = await getJson<[unknown, WorldBankRow[] | null]>(url, { ttlMs: 24 * 60 * 60 * 1000 });
  return payload[1]?.[0] ?? {};
}

export async function fetchGeopolitics(factor: Factor): Promise<FactorReading> {
  const query = encodeURIComponent("(war OR invasion OR sanctions OR conflict)");
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=timelinevol&format=json&timespan=7d`;
  const payload = await readGdelt(url);
  const data = payload.timeline?.[0]?.data ?? [];
  const points = data
    .filter((row) => row.date && typeof row.value === "number")
    .map((row) => ({ time: gdeltTime(row.date as string), value: row.value as number }));
  const latest = points[points.length - 1];
  if (!latest) throw new Error("GDELT returned no timeline");
  const previous = points[points.length - 2];
  return reading(factor, {
    asOf: latest.time,
    value: latest.value,
    unit: "articles in the latest GDELT bucket",
    change: previous ? latest.value - previous.value : null,
    changeUnit: "articles",
    series: tail(points, 8),
    fetchedFrom: url,
    summary: `${latest.value} articles matching war, invasion, sanctions, or conflict`,
    note: "This is English-language article volume, not a severity score.",
  });
}

async function readGdelt(url: string): Promise<{ timeline?: Array<{ data?: Array<{ date?: string; value?: number }> }> }> {
  const options = { ttlMs: 15 * 60 * 1000, curlFallback: true };
  try {
    return await getJson(url, options);
  } catch (error) {
    if (!retryableGdelt(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    return getJson(url, options);
  }
}

function retryableGdelt(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return error.status === 429 || error.status === null || (error.status !== null && error.status >= 500);
}

function gdeltTime(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

export async function fetchRegulation(factor: Factor): Promise<FactorReading> {
  const url = "https://www.sec.gov/news/pressreleases.rss";
  const items = parseRssItems(await getText(url, { ttlMs: 30 * 60 * 1000 })).slice(0, 20);
  const crypto = items.filter((item) => /bitcoin|crypto|digital asset|ether|stablecoin|tokeniz|custody/i.test(item.title));
  return reading(factor, {
    asOf: items[0]?.date ?? null,
    value: items.length,
    unit: "press releases in the current SEC feed",
    fetchedFrom: url,
    summary: items.slice(0, 4).map((item) => item.title).join(" | "),
    detail: { cryptoRelated: crypto, releases: items },
    note: "value counts releases in the feed. detail.cryptoRelated is the subset whose title mentions crypto markets.",
  });
}

interface HackEvent {
  date?: number;
  name?: string;
  classification?: string;
  technique?: string;
  amount?: number | null;
  chain?: string[];
}

export async function fetchHacks(factor: Factor): Promise<FactorReading> {
  const url = "https://api.llama.fi/hacks";
  const events = await getJson<HackEvent[]>(url, { ttlMs: 60 * 60 * 1000 });
  const cutoff = Date.now() / 1000 - 30 * 24 * 60 * 60;
  const recent = events
    .filter((event) => typeof event.date === "number" && event.date >= cutoff)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  const stolen = recent.reduce((sum, event) => sum + (typeof event.amount === "number" ? event.amount : 0), 0);
  return reading(factor, {
    asOf: recent[0]?.date ? new Date(recent[0].date * 1000).toISOString() : null,
    value: round(stolen, 0),
    unit: "USD reported stolen in the last 30 days",
    fetchedFrom: url,
    summary: `${recent.length} incidents, ${round(stolen, 0)} USD with a reported amount`,
    detail: {
      incidents: recent.length,
      unpricedIncidents: recent.filter((event) => typeof event.amount !== "number").length,
      events: recent.slice(0, 8).map((event) => ({
        date: event.date ? new Date(event.date * 1000).toISOString() : null,
        name: event.name ?? null,
        amountUsd: event.amount ?? null,
        classification: event.classification ?? null,
        technique: event.technique ?? null,
        chains: event.chain ?? [],
      })),
    },
    note: "Structured incidents from DefiLlama. rekt.news is the cited write-up site and does not expose a stable feed.",
  });
}
