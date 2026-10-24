import { envValue, getJson, getText, round } from "../http.js";
import { parseCamecoPrices, parseFarsideFlows, parseTreasuryCurves, parseYahooChart } from "../parse.js";
import type { Factor, FactorReading } from "../types.js";
import { reading, tail } from "./shared.js";

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";

async function yahoo(factor: Factor, symbol: string, unit: string, note?: string): Promise<FactorReading> {
  const url = `${YAHOO}/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const quote = parseYahooChart(await getJson(url));
  return reading(factor, {
    asOf: quote.time,
    value: round(quote.price, quote.price >= 100 ? 2 : 4),
    unit,
    change: quote.changePercent === null ? null : round(quote.changePercent, 3),
    changeUnit: "percent",
    series: tail(quote.closes, 8).map((point) => ({ ...point, value: round(point.value, 4) })),
    fetchedFrom: url,
    summary: `${quote.name ?? symbol} ${round(quote.price, 2)} ${unit}`,
    note: note ?? null,
    detail: { symbol, previousClose: quote.previousClose },
  });
}

export function fetchDxy(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "DX-Y.NYB", "index");
}

export function fetchNasdaq(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "^NDX", "index");
}

export function fetchSp500(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "^GSPC", "index");
}

export function fetchVix(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "^VIX", "index");
}

export function fetchSilver(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "SI=F", "USD/oz", "COMEX front-month future. LBMA's own price file is behind Cloudflare.");
}

export function fetchCopper(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "HG=F", "USD/lb", "COMEX front-month future. The LME does not publish an open price API.");
}

export async function fetchNaturalGas(factor: Factor): Promise<FactorReading> {
  const base = await yahoo(factor, "NG=F", "USD/MMBtu", "NYMEX front-month future.");
  const key = envValue("EIA_API_KEY");
  if (!key) return base;
  try {
    const url =
      "https://api.eia.gov/v2/natural-gas/pri/fut/data/?frequency=daily&data[0]=value" +
      "&facets[series][]=RNGWHHD&sort[0][column]=period&sort[0][direction]=desc&length=1" +
      `&api_key=${encodeURIComponent(key)}`;
    const payload = await getJson<{ response?: { data?: Array<{ period?: string; value?: number | string }> } }>(url);
    const row = payload.response?.data?.[0];
    const henryHub = typeof row?.value === "number" ? row.value : Number(row?.value);
    return reading(factor, {
      ...base,
      detail: {
        ...base.detail,
        eiaHenryHubUsdPerMcf: Number.isFinite(henryHub) ? henryHub : null,
        eiaPeriod: row?.period ?? null,
      },
      note: "Headline is the NYMEX future. detail.eiaHenryHubUsdPerMcf is the EIA Henry Hub series.",
    });
  } catch (error) {
    return reading(factor, {
      ...base,
      note: `NYMEX future. EIA Henry Hub was not added: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function fetchWheat(factor: Factor): Promise<FactorReading> {
  return yahoo(factor, "ZW=F", "USc/bushel", "CBOT wheat future. CME quotes this contract in US cents per bushel.");
}

export async function fetchYields(factor: Factor): Promise<FactorReading> {
  const year = new Date().getUTCFullYear();
  const url =
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml" +
    `?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const curves = parseTreasuryCurves(await getText(url, { ttlMs: 30 * 60 * 1000 }));
  const latest = curves[curves.length - 1];
  const previous = curves[curves.length - 2];
  if (!latest?.yields["10Y"]) throw new Error("Treasury yield curve had no 10-year yield");
  const previous10 = previous?.yields["10Y"];
  return reading(factor, {
    asOf: latest.date,
    value: latest.yields["10Y"],
    unit: "percent, 10-year",
    change: previous10 === undefined ? null : round(latest.yields["10Y"] - previous10, 3),
    changeUnit: "percentage points",
    series: tail(curves, 8)
      .filter((curve) => curve.yields["10Y"] !== undefined)
      .map((curve) => ({ time: curve.date, value: curve.yields["10Y"] as number })),
    fetchedFrom: url,
    summary: `10-year ${latest.yields["10Y"]}%, 2-year ${latest.yields["2Y"] ?? "n/a"}%`,
    detail: { curve: latest.yields, previousDate: previous?.date ?? null },
  });
}

interface NyFedRate {
  effectiveDate?: string;
  type?: string;
  percentRate?: number;
  targetRateFrom?: number;
  targetRateTo?: number;
  volumeInBillions?: number;
}

export async function fetchFedFunds(factor: Factor): Promise<FactorReading> {
  const url = "https://markets.newyorkfed.org/api/rates/all/latest.json";
  const payload = await getJson<{ refRates?: NyFedRate[] }>(url);
  const effr = payload.refRates?.find((rate) => rate.type === "EFFR" && typeof rate.percentRate === "number");
  if (!effr?.percentRate) throw new Error("NY Fed response had no EFFR");
  return reading(factor, {
    asOf: effr.effectiveDate ?? null,
    value: effr.percentRate,
    unit: "percent, effective federal funds rate",
    fetchedFrom: url,
    summary: `EFFR ${effr.percentRate}% , target ${effr.targetRateFrom ?? "?"}–${effr.targetRateTo ?? "?"}%`,
    detail: {
      targetRateFrom: effr.targetRateFrom ?? null,
      targetRateTo: effr.targetRateTo ?? null,
      volumeInBillions: effr.volumeInBillions ?? null,
    },
  });
}

export async function fetchUranium(factor: Factor): Promise<FactorReading> {
  const url = "https://www.cameco.com/invest/markets/uranium-price";
  const rows = parseCamecoPrices(await getText(url, { ttlMs: 6 * 60 * 60 * 1000 })).filter((row) => row.spot !== null);
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  if (!latest?.spot) throw new Error("Cameco page had no uranium spot price");
  return reading(factor, {
    asOf: latest.date,
    value: latest.spot,
    unit: "USD/lb U3O8",
    change: previous?.spot === null || previous?.spot === undefined ? null : round(latest.spot - previous.spot, 2),
    changeUnit: "USD/lb",
    series: tail(rows, 8).map((row) => ({ time: row.date, value: row.spot as number })),
    fetchedFrom: url,
    summary: `Spot ${latest.spot} USD/lb on ${latest.date}`,
    detail: { longTermUsdPerLb: latest.longTerm },
    note: "Cameco month-end industry average. Uranium does not trade on an open exchange.",
  });
}

export async function fetchEtfFlows(factor: Factor): Promise<FactorReading> {
  const url = "https://farside.co.uk/btc/";
  const rows = parseFarsideFlows(await getText(url, { ttlMs: 30 * 60 * 1000, curlFallback: true })).filter((row) => row.total !== null);
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  if (!latest?.total && latest?.total !== 0) throw new Error("Farside table had no total flow");
  const recent = tail(rows, 10);
  const fiveDay = recent.slice(-5).reduce((sum, row) => sum + (row.total ?? 0), 0);
  return reading(factor, {
    asOf: new Date(latest.date).toISOString(),
    value: latest.total,
    unit: "USD millions, daily net flow",
    change: previous?.total === null || previous?.total === undefined ? null : round(latest.total - previous.total, 1),
    changeUnit: "USD millions",
    series: recent.map((row) => ({ time: row.date, value: row.total as number })),
    fetchedFrom: url,
    summary: `${latest.date} total ${latest.total} US$m`,
    detail: { issuersUsdMillions: latest.issuers, lastFiveSessionsUsdMillions: round(fiveDay, 1) },
    note: "Parentheses on the Farside table are outflows and are returned as negative numbers.",
  });
}
