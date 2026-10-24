import { envValue, getJson, round } from "../http.js";
import { parseBlockchainChart } from "../parse.js";
import type { Factor, FactorReading, Point } from "../types.js";
import { errorMessage, reading, tail, unavailable } from "./shared.js";

interface CoinMarket {
  id?: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
  last_updated?: string;
}

interface CoinGlobal {
  data?: {
    total_market_cap?: { usd?: number };
    total_volume?: { usd?: number };
    market_cap_percentage?: { btc?: number; eth?: number };
    market_cap_change_percentage_24h_usd?: number;
    updated_at?: number;
  };
}

const MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&price_change_percentage=24h";
const GLOBAL_URL = "https://api.coingecko.com/api/v3/global";

function coinGeckoHeaders(): Record<string, string> {
  const pro = envValue("COINGECKO_PRO_API_KEY");
  const demo = envValue("COINGECKO_DEMO_API_KEY");
  if (pro) return { "x-cg-pro-api-key": pro };
  if (demo) return { "x-cg-demo-api-key": demo };
  return {};
}

async function markets(): Promise<CoinMarket[]> {
  return getJson<CoinMarket[]>(MARKETS_URL, { headers: coinGeckoHeaders() });
}

async function globalStats(): Promise<NonNullable<CoinGlobal["data"]>> {
  const payload = await getJson<CoinGlobal>(GLOBAL_URL, { headers: coinGeckoHeaders() });
  if (!payload.data) throw new Error("CoinGecko global response had no data");
  return payload.data;
}

export async function fetchEthereum(factor: Factor): Promise<FactorReading> {
  const coin = (await markets()).find((item) => item.id === "ethereum");
  if (typeof coin?.current_price !== "number") throw new Error("CoinGecko returned no ETH price");
  return reading(factor, {
    asOf: coin.last_updated ?? null,
    value: coin.current_price,
    unit: "USD",
    change: round(coin.price_change_percentage_24h ?? 0, 3),
    changeUnit: "percent, 24h",
    fetchedFrom: MARKETS_URL,
    summary: `ETH ${coin.current_price} USD`,
    detail: { marketCapUsd: coin.market_cap ?? null, volume24hUsd: coin.total_volume ?? null },
  });
}

export async function fetchBitcoinVolume(factor: Factor): Promise<FactorReading> {
  const coin = (await markets()).find((item) => item.id === "bitcoin");
  if (typeof coin?.total_volume !== "number") throw new Error("CoinGecko returned no BTC volume");
  return reading(factor, {
    asOf: coin.last_updated ?? null,
    value: round(coin.total_volume, 0),
    unit: "USD, 24h volume",
    fetchedFrom: MARKETS_URL,
    summary: `BTC 24h volume ${round(coin.total_volume, 0)} USD`,
    detail: { priceUsd: coin.current_price ?? null, change24hPercent: coin.price_change_percentage_24h ?? null },
  });
}

export async function fetchCryptoMarketCap(factor: Factor): Promise<FactorReading> {
  const data = await globalStats();
  const total = data.total_market_cap?.usd;
  if (typeof total !== "number") throw new Error("CoinGecko returned no total market cap");
  return reading(factor, {
    asOf: data.updated_at ? new Date(data.updated_at * 1000).toISOString() : null,
    value: round(total, 0),
    unit: "USD",
    change: round(data.market_cap_change_percentage_24h_usd ?? 0, 3),
    changeUnit: "percent, 24h",
    fetchedFrom: GLOBAL_URL,
    summary: `Total crypto market cap ${round(total, 0)} USD`,
    detail: { totalVolume24hUsd: data.total_volume?.usd ?? null },
  });
}

export async function fetchDominance(factor: Factor): Promise<FactorReading> {
  const data = await globalStats();
  const dominance = data.market_cap_percentage?.btc;
  if (typeof dominance !== "number") throw new Error("CoinGecko returned no BTC dominance");
  return reading(factor, {
    asOf: data.updated_at ? new Date(data.updated_at * 1000).toISOString() : null,
    value: round(dominance, 2),
    unit: "percent of crypto market cap",
    fetchedFrom: GLOBAL_URL,
    summary: `BTC dominance ${round(dominance, 2)}%`,
    detail: { ethPercent: data.market_cap_percentage?.eth ?? null },
    note: "CoinGecko share of total crypto market cap. CoinMarketCap's chart requires an API key.",
  });
}

interface StablechartRow {
  date?: string | number;
  totalCirculatingUSD?: { peggedUSD?: number };
  totalCirculating?: { peggedUSD?: number };
}

export async function fetchStablecoins(factor: Factor): Promise<FactorReading> {
  const url = "https://stablecoins.llama.fi/stablecoincharts/all";
  const rows = await getJson<StablechartRow[]>(url, { ttlMs: 30 * 60 * 1000 });
  const points = rows
    .map((row) => {
      const value = row.totalCirculatingUSD?.peggedUSD ?? row.totalCirculating?.peggedUSD;
      const time = typeof row.date === "number" ? new Date(row.date * 1000).toISOString() : row.date ?? null;
      return typeof value === "number" && time ? { time, value } : null;
    })
    .filter((point): point is Point => point !== null);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest) throw new Error("DefiLlama returned no stablecoin total");
  return reading(factor, {
    asOf: latest.time,
    value: round(latest.value, 0),
    unit: "USD circulating",
    change: previous ? round(latest.value - previous.value, 0) : null,
    changeUnit: "USD, day",
    series: tail(points, 8).map((point) => ({ ...point, value: round(point.value, 0) })),
    fetchedFrom: url,
    summary: `Stablecoins ${round(latest.value / 1e9, 2)} billion USD`,
  });
}

interface PremiumIndex {
  symbol?: string;
  markPrice?: string;
  lastFundingRate?: string;
  nextFundingTime?: number;
  time?: number;
}

async function premiumIndex(): Promise<PremiumIndex> {
  return getJson<PremiumIndex>("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
}

export async function fetchFunding(factor: Factor): Promise<FactorReading> {
  const url = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT";
  const data = await premiumIndex();
  const rate = Number(data.lastFundingRate);
  if (!Number.isFinite(rate)) throw new Error("Binance returned no funding rate");
  const percent = rate * 100;
  return reading(factor, {
    asOf: data.time ? new Date(data.time).toISOString() : null,
    value: round(percent, 6),
    unit: "percent per 8h",
    fetchedFrom: url,
    summary: `BTCUSDT funding ${round(percent, 4)}% per 8h`,
    detail: {
      annualizedPercent: round(rate * 3 * 365 * 100, 2),
      markPriceUsd: Number(data.markPrice),
      nextFundingTime: data.nextFundingTime ? new Date(data.nextFundingTime).toISOString() : null,
    },
    note: "Binance USDT-margined perpetual. CoinGlass cross-exchange funding requires a paid key and is not called.",
  });
}

export async function fetchOpenInterest(factor: Factor): Promise<FactorReading> {
  const url = "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT";
  const [oi, premium] = await Promise.all([
    getJson<{ openInterest?: string; time?: number }>(url),
    premiumIndex(),
  ]);
  const contracts = Number(oi.openInterest);
  const mark = Number(premium.markPrice);
  if (!Number.isFinite(contracts)) throw new Error("Binance returned no open interest");
  return reading(factor, {
    asOf: oi.time ? new Date(oi.time).toISOString() : null,
    value: round(contracts, 3),
    unit: "BTC, Binance USDT perpetual",
    fetchedFrom: url,
    summary: `BTCUSDT open interest ${round(contracts, 1)} BTC`,
    detail: { notionalUsd: Number.isFinite(mark) ? round(contracts * mark, 0) : null },
    note: "Single-venue open interest. A cross-exchange total needs CoinGlass or a similar paid feed.",
  });
}

interface GlassnodePoint {
  t: number;
  v: number;
}

async function glassnode(metric: string): Promise<GlassnodePoint[]> {
  const key = envValue("GLASSNODE_API_KEY");
  if (!key) throw new Error("GLASSNODE_API_KEY is not set");
  const since = Math.floor(Date.now() / 1000) - 40 * 24 * 60 * 60;
  const url =
    `https://api.glassnode.com/v1/metrics/${metric}?a=BTC&i=24h&s=${since}&f=json&api_key=${encodeURIComponent(key)}`;
  const payload = await getJson<unknown>(url, { ttlMs: 30 * 60 * 1000 });
  if (!Array.isArray(payload)) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "Unexpected Glassnode response";
    throw new Error(message);
  }
  return payload.filter(
    (row): row is GlassnodePoint =>
      !!row && typeof row === "object" && typeof (row as GlassnodePoint).t === "number" && typeof (row as GlassnodePoint).v === "number",
  );
}

function glassnodeReading(
  factor: Factor,
  metric: string,
  points: GlassnodePoint[],
  unit: string,
  note: string,
): FactorReading {
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest) throw new Error(`Glassnode ${metric} returned no points`);
  return reading(factor, {
    asOf: new Date(latest.t * 1000).toISOString(),
    value: latest.v,
    unit,
    change: previous ? latest.v - previous.v : null,
    changeUnit: unit,
    series: tail(points, 8).map((point) => ({ time: new Date(point.t * 1000).toISOString(), value: point.v })),
    fetchedFrom: `https://api.glassnode.com/v1/metrics/${metric}?a=BTC&i=24h`,
    summary: `${metric} ${latest.v}`,
    note,
  });
}

export async function fetchLthSupply(factor: Factor): Promise<FactorReading> {
  if (!envValue("GLASSNODE_API_KEY")) return unavailable(factor, "GLASSNODE_API_KEY", "Long-term holder supply is a Glassnode metric.");
  const points = await glassnode("supply/lth_sum");
  return glassnodeReading(factor, "supply/lth_sum", points, "BTC", "Supply held by long-term holders.");
}

export async function fetchMvrv(factor: Factor): Promise<FactorReading> {
  if (!envValue("GLASSNODE_API_KEY")) return unavailable(factor, "GLASSNODE_API_KEY", "MVRV is a Glassnode metric. onchainlab does not publish an open API.");
  const points = await glassnode("market/mvrv");
  return glassnodeReading(factor, "market/mvrv", points, "ratio", "Market value divided by realized value. Above 1 means the market price is above the aggregate cost basis.");
}

export async function fetchSopr(factor: Factor): Promise<FactorReading> {
  if (!envValue("GLASSNODE_API_KEY")) return unavailable(factor, "GLASSNODE_API_KEY", "SOPR is a Glassnode metric.");
  const points = await glassnode("indicators/sopr");
  return glassnodeReading(factor, "indicators/sopr", points, "ratio", "Above 1 means coins moved that day were spent at a profit.");
}

export async function fetchNupl(factor: Factor): Promise<FactorReading> {
  if (!envValue("GLASSNODE_API_KEY")) return unavailable(factor, "GLASSNODE_API_KEY", "NUPL is a Glassnode metric.");
  const points = await glassnode("indicators/net_unrealized_profit_loss");
  return glassnodeReading(factor, "indicators/net_unrealized_profit_loss", points, "ratio", "Net unrealized profit or loss of the circulating supply.");
}

export async function fetchWhaleFlows(factor: Factor): Promise<FactorReading> {
  if (!envValue("GLASSNODE_API_KEY")) return unavailable(factor, "GLASSNODE_API_KEY", "Whale exchange flows are Glassnode metrics.");
  const toExchangeMetric = "transactions/transfers_volume_whales_to_exchanges";
  const fromExchangeMetric = "transactions/transfers_volume_exchanges_to_whales";
  const [toExchange, fromExchange] = await Promise.all([
    glassnode(toExchangeMetric),
    glassnode(fromExchangeMetric).catch(() => [] as GlassnodePoint[]),
  ]);
  const latestTo = toExchange[toExchange.length - 1];
  const latestFrom = fromExchange[fromExchange.length - 1];
  if (!latestTo) throw new Error("Glassnode returned no whale-to-exchange volume");
  const net = latestFrom ? latestTo.v - latestFrom.v : latestTo.v;
  return reading(factor, {
    asOf: new Date(latestTo.t * 1000).toISOString(),
    value: net,
    unit: "BTC, whale net flow onto exchanges",
    fetchedFrom: `https://api.glassnode.com/v1/metrics/${toExchangeMetric}?a=BTC&i=24h`,
    summary: `Whale net to exchanges ${net} BTC`,
    detail: {
      whalesToExchangesBtc: latestTo.v,
      exchangesToWhalesBtc: latestFrom?.v ?? null,
    },
    note: latestFrom
      ? "Positive means whales sent more BTC to exchanges than they withdrew."
      : "Only whale-to-exchange volume was available. The exchange-to-whale series did not return.",
  });
}

interface CryptoQuantRow {
  [key: string]: unknown;
}

async function cryptoQuant(path: string): Promise<CryptoQuantRow[]> {
  const key = envValue("CRYPTOQUANT_API_KEY");
  if (!key) throw new Error("CRYPTOQUANT_API_KEY is not set");
  const url = `https://api.cryptoquant.com/v1/${path}`;
  const payload = await getJson<{ result?: { data?: CryptoQuantRow[] } }>(url, {
    headers: { authorization: `Bearer ${key}` },
    ttlMs: 30 * 60 * 1000,
  });
  const data = payload.result?.data;
  if (!data?.length) throw new Error("CryptoQuant returned no rows");
  return data;
}

function cryptoQuantReading(factor: Factor, rows: CryptoQuantRow[], field: string, unit: string, fetchedPath: string): FactorReading {
  const latest = rows[rows.length - 1] ?? {};
  const previous = rows[rows.length - 2];
  const value = numberField(latest, field);
  const previousValue = previous ? numberField(previous, field) : null;
  if (value === null) throw new Error(`CryptoQuant row had no ${field}`);
  const time = stringField(latest, "date") ?? stringField(latest, "datetime");
  return reading(factor, {
    asOf: time,
    value,
    unit,
    change: previousValue === null ? null : value - previousValue,
    changeUnit: unit,
    series: rows
      .map((row) => {
        const rowValue = numberField(row, field);
        const rowTime = stringField(row, "date") ?? stringField(row, "datetime");
        return rowValue === null || !rowTime ? null : { time: rowTime, value: rowValue };
      })
      .filter((point): point is Point => point !== null),
    fetchedFrom: `https://api.cryptoquant.com/v1/${fetchedPath}`,
    summary: `${field} ${value} ${unit}`,
  });
}

function numberField(row: CryptoQuantRow, field: string): number | null {
  const value = row[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringField(row: CryptoQuantRow, field: string): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

export async function fetchExchangeBalances(factor: Factor): Promise<FactorReading> {
  if (!envValue("CRYPTOQUANT_API_KEY")) {
    return unavailable(factor, "CRYPTOQUANT_API_KEY", "All-exchange Bitcoin reserves are a CryptoQuant series.");
  }
  const path = "btc/exchange-flows/reserve?exchange=all_exchange&window=day&limit=8";
  return cryptoQuantReading(factor, await cryptoQuant(path), "reserve", "BTC", path);
}

export async function fetchExchangeNetflows(factor: Factor): Promise<FactorReading> {
  if (!envValue("CRYPTOQUANT_API_KEY")) {
    return unavailable(factor, "CRYPTOQUANT_API_KEY", "Exchange netflows are a CryptoQuant series.");
  }
  const path = "btc/exchange-flows/netflow?exchange=all_exchange&window=day&limit=8";
  const result = cryptoQuantReading(factor, await cryptoQuant(path), "netflow", "BTC per day", path);
  return reading(factor, {
    ...result,
    note: "Positive netflow means more BTC moved onto exchanges than left them.",
  });
}

interface HashratePoint {
  timestamp?: number;
  avgHashrate?: number;
}

export async function fetchMiners(factor: Factor): Promise<FactorReading> {
  const url = "https://mempool.space/api/v1/mining/hashrate/1m";
  const payload = await getJson<{ hashrates?: HashratePoint[] }>(url);
  const points = (payload.hashrates ?? []).filter(
    (point): point is { timestamp: number; avgHashrate: number } =>
      typeof point.timestamp === "number" && typeof point.avgHashrate === "number",
  );
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest) throw new Error("mempool.space returned no hashrate");
  const eh = (value: number) => value / 1e18;
  let pools: Array<{ pool: string; sharePercent: number }> = [];
  let difficulty: Record<string, unknown> | null = null;
  try {
    const poolRows = await getJson<Array<{ poolName?: string; share?: number }>>(
      "https://mempool.space/api/v1/mining/hashrate/pools/1w",
    );
    pools = poolRows.slice(0, 5).map((pool) => ({
      pool: pool.poolName ?? "unknown",
      sharePercent: round((pool.share ?? 0) * 100, 2),
    }));
  } catch (error) {
    pools = [];
    difficulty = { poolError: errorMessage(error) };
  }
  try {
    difficulty = {
      ...(difficulty ?? {}),
      ...(await getJson<Record<string, unknown>>("https://mempool.space/api/v1/difficulty-adjustment")),
    };
  } catch {
    difficulty = difficulty ?? null;
  }
  return reading(factor, {
    asOf: new Date(latest.timestamp * 1000).toISOString(),
    value: round(eh(latest.avgHashrate), 2),
    unit: "EH/s",
    change: previous ? round(eh(latest.avgHashrate - previous.avgHashrate), 2) : null,
    changeUnit: "EH/s, day",
    series: tail(points, 8).map((point) => ({
      time: new Date(point.timestamp * 1000).toISOString(),
      value: round(eh(point.avgHashrate), 2),
    })),
    fetchedFrom: url,
    summary: `Hashrate ${round(eh(latest.avgHashrate), 1)} EH/s`,
    detail: { topPoolsWeek: pools, difficultyAdjustment: difficulty },
  });
}

export async function fetchActiveAddresses(factor: Factor): Promise<FactorReading> {
  const url = "https://api.blockchain.info/charts/n-unique-addresses?timespan=30days&sampled=true&format=json";
  const chart = parseBlockchainChart(await getJson(url));
  const latest = chart.points[chart.points.length - 1];
  const previous = chart.points[chart.points.length - 2];
  if (!latest) throw new Error("No active-address observations");
  return reading(factor, {
    asOf: latest.time,
    value: round(latest.value, 0),
    unit: "unique addresses per day",
    change: previous ? round(latest.value - previous.value, 0) : null,
    changeUnit: "addresses",
    series: tail(chart.points, 8).map((point) => ({ ...point, value: round(point.value, 0) })),
    fetchedFrom: url,
    summary: `${round(latest.value, 0)} unique addresses`,
  });
}

export async function fetchFeesAndTransactions(factor: Factor): Promise<FactorReading> {
  const txUrl = "https://api.blockchain.info/charts/n-transactions?timespan=30days&sampled=true&format=json";
  const feeUrl = "https://mempool.space/api/v1/fees/recommended";
  const [chart, fees, feeUsd] = await Promise.all([
    getJson(txUrl).then(parseBlockchainChart),
    getJson<{ fastestFee?: number; halfHourFee?: number; hourFee?: number; economyFee?: number }>(feeUrl),
    getJson("https://api.blockchain.info/charts/transaction-fees-usd?timespan=14days&sampled=true&format=json")
      .then(parseBlockchainChart)
      .catch(() => null),
  ]);
  const latest = chart.points[chart.points.length - 1];
  const previous = chart.points[chart.points.length - 2];
  if (!latest) throw new Error("No transaction observations");
  const latestFees = feeUsd?.points[feeUsd.points.length - 1];
  return reading(factor, {
    asOf: latest.time,
    value: round(latest.value, 0),
    unit: "confirmed transactions per day",
    change: previous ? round(latest.value - previous.value, 0) : null,
    changeUnit: "transactions",
    series: tail(chart.points, 8).map((point) => ({ ...point, value: round(point.value, 0) })),
    fetchedFrom: txUrl,
    summary: `${round(latest.value, 0)} transactions, fastest fee ${fees.fastestFee ?? "?"} sat/vB`,
    detail: {
      fastestFeeSatPerVb: fees.fastestFee ?? null,
      halfHourFeeSatPerVb: fees.halfHourFee ?? null,
      hourFeeSatPerVb: fees.hourFee ?? null,
      economyFeeSatPerVb: fees.economyFee ?? null,
      dailyFeesUsd: latestFees ? round(latestFees.value, 0) : null,
      feeQuoteFrom: feeUrl,
    },
  });
}

interface OptionRow {
  instrument_name?: string;
  open_interest?: number;
  volume?: number;
  mark_iv?: number;
}

export async function fetchPutCall(factor: Factor): Promise<FactorReading> {
  const url = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option";
  const payload = await getJson<{ result?: OptionRow[] }>(url, { ttlMs: 10 * 60 * 1000 });
  let putOi = 0;
  let callOi = 0;
  let putVolume = 0;
  let callVolume = 0;
  for (const row of payload.result ?? []) {
    const name = row.instrument_name ?? "";
    const openInterest = row.open_interest ?? 0;
    const volume = row.volume ?? 0;
    if (name.endsWith("-P")) {
      putOi += openInterest;
      putVolume += volume;
    } else if (name.endsWith("-C")) {
      callOi += openInterest;
      callVolume += volume;
    }
  }
  if (callOi === 0) throw new Error("Deribit option book had no call open interest");
  return reading(factor, {
    asOf: new Date().toISOString(),
    value: round(putOi / callOi, 4),
    unit: "put open interest / call open interest",
    fetchedFrom: url,
    summary: `Put/call open interest ${round(putOi / callOi, 3)}`,
    detail: {
      putOpenInterestBtc: round(putOi, 2),
      callOpenInterestBtc: round(callOi, 2),
      putVolumeBtc: round(putVolume, 2),
      callVolumeBtc: round(callVolume, 2),
      volumeRatio: callVolume === 0 ? null : round(putVolume / callVolume, 4),
    },
    note: "Whole Deribit BTC option book, not a single expiry.",
  });
}

export async function fetchImpliedVol(factor: Factor): Promise<FactorReading> {
  const end = Date.now();
  const start = end - 3 * 24 * 60 * 60 * 1000;
  const url =
    "https://www.deribit.com/api/v2/public/get_volatility_index_data" +
    `?currency=BTC&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`;
  const payload = await getJson<{ result?: { data?: number[][] } }>(url);
  const candles = payload.result?.data ?? [];
  const points = candles
    .filter((candle) => candle.length >= 5 && typeof candle[0] === "number" && typeof candle[4] === "number")
    .map((candle) => ({ time: new Date(candle[0] as number).toISOString(), value: candle[4] as number }));
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest) throw new Error("Deribit returned no DVOL candles");
  return reading(factor, {
    asOf: latest.time,
    value: round(latest.value, 2),
    unit: "percent, DVOL",
    change: previous ? round(latest.value - previous.value, 2) : null,
    changeUnit: "percentage points, hour",
    series: tail(points, 12).map((point) => ({ ...point, value: round(point.value, 2) })),
    fetchedFrom: "https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600",
    summary: `BTC DVOL ${round(latest.value, 2)}`,
  });
}

interface AggTrade {
  p?: string;
  q?: string;
  T?: number;
  m?: boolean;
}

export async function fetchSpotCvd(factor: Factor): Promise<FactorReading> {
  const url = "https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&limit=1000";
  const trades = await getJson<AggTrade[]>(url);
  if (trades.length === 0) throw new Error("Binance returned no aggregate trades");
  let buy = 0;
  let sell = 0;
  const start = trades[0]?.T ?? Date.now();
  const end = trades[trades.length - 1]?.T ?? start;
  const span = Math.max(1, end - start);
  const buckets = [0, 0, 0, 0, 0];
  for (const trade of trades) {
    const quantity = Number(trade.q);
    if (!Number.isFinite(quantity)) continue;
    const signed = trade.m ? -quantity : quantity;
    if (trade.m) sell += quantity;
    else buy += quantity;
    const index = Math.min(buckets.length - 1, Math.floor((((trade.T ?? start) - start) / span) * buckets.length));
    buckets[index] = (buckets[index] ?? 0) + signed;
  }
  const delta = buy - sell;
  return reading(factor, {
    asOf: new Date(end).toISOString(),
    value: round(delta, 4),
    unit: "BTC taker buy minus taker sell",
    fetchedFrom: url,
    summary: `Taker delta ${round(delta, 3)} BTC over the latest ${trades.length} trades`,
    series: buckets.map((value, index) => ({
      time: new Date(start + (span * index) / buckets.length).toISOString(),
      value: round(value, 4),
    })),
    detail: {
      takerBuyBtc: round(buy, 4),
      takerSellBtc: round(sell, 4),
      trades: trades.length,
      windowStart: new Date(start).toISOString(),
    },
    note: "This is the signed taker volume of the latest 1,000 Binance spot prints, not a full-session cumulative volume delta.",
  });
}
