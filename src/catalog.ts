import { GROUP_LABELS, type Factor, type GroupId } from "./types.js";

function factor(
  id: number,
  slug: string,
  nameHe: string,
  nameEn: string,
  weightPercent: number,
  citedSource: string,
  group: GroupId,
  liveSource: string,
  requiresEnv?: string,
): Factor {
  return {
    id,
    slug,
    nameHe,
    nameEn,
    weightPercent,
    citedSource,
    group,
    liveSource,
    ...(requiresEnv ? { requiresEnv } : {}),
  };
}

export const FACTORS: readonly Factor[] = [
  factor(1, "dxy", "מדד הדולר DXY", "US Dollar Index", 5.95, "https://finance.yahoo.com/quote/DX-Y.NYB/", "liquidity", "Yahoo Finance chart for ICE DX-Y.NYB"),
  factor(2, "ust-yields", "תשואות אגח ארהב", "US Treasury yields", 5.95, "https://home.treasury.gov/resource-center/data-chart-center/interest-rates", "liquidity", "US Treasury daily yield curve XML"),
  factor(3, "fed-funds", "ריבית הפדרל ריזרב", "Federal Reserve policy rate", 5.95, "https://www.federalreserve.gov/monetarypolicy/openmarket.htm", "liquidity", "New York Fed effective federal funds rate and target range"),
  factor(4, "nasdaq100", "NASDAQ-100", "NASDAQ-100", 2.55, "https://www.nasdaq.com/market-activity/indexes/ndx", "risk", "Yahoo Finance chart for ^NDX"),
  factor(5, "sp500", "S&P 500", "S&P 500", 0.85, "https://www.spglobal.com/spdji/en/indices/equity/sp-500/", "risk", "Yahoo Finance chart for ^GSPC"),
  factor(6, "vix", "מדד VIX", "CBOE VIX", 1.7, "https://www.cboe.com/tradable_products/vix/", "risk", "Yahoo Finance chart for ^VIX"),
  factor(7, "silver", "כסף Silver", "Silver", 0.85, "https://www.lbma.org.uk/prices-and-data/precious-metal-prices", "risk", "COMEX silver future SI=F. LBMA blocks anonymous downloads."),
  factor(8, "copper", "נחושת", "Copper", 0.85, "https://www.lme.com/en/metals/non-ferrous/lme-copper", "risk", "COMEX copper future HG=F. LME has no open JSON feed."),
  factor(9, "natural-gas", "גז טבעי", "Natural gas", 0.85, "https://www.eia.gov/dnav/ng/ng_pri_fut_s1_d.htm", "risk", "NYMEX natural gas future NG=F. EIA Henry Hub is added when EIA_API_KEY is set."),
  factor(10, "uranium", "אורניום", "Uranium", 0.85, "https://www.cameco.com/invest/markets/uranium-price", "risk", "Cameco month-end spot price table"),
  factor(11, "wheat", "חיטה ומחירי מזון", "Wheat and food prices", 0.85, "https://www.cmegroup.com/markets/agriculture/grains/wheat.html", "risk", "CBOT wheat future ZW=F, quoted in US cents per bushel"),
  factor(12, "ethereum", "Ethereum ETH", "Ethereum", 1.7, "https://www.coingecko.com/en/coins/ethereum", "crypto", "CoinGecko markets API"),
  factor(13, "crypto-market-cap", "שווי שוק הקריפטו הכולל", "Total crypto market cap", 2.55, "https://www.coingecko.com/en/global-charts", "crypto", "CoinGecko global API"),
  factor(14, "btc-etf-flows", "זרימות Bitcoin ETF", "Bitcoin ETF flows", 7.65, "https://farside.co.uk/btc/", "crypto", "Farside US spot Bitcoin ETF flow table, US$ millions"),
  factor(15, "stablecoins", "היצע Stablecoins", "Stablecoin supply", 3.4, "https://defillama.com/stablecoins", "crypto", "DefiLlama stablecoin circulating supply"),
  factor(16, "btc-volume", "נפח מסחר בביטקוין", "Bitcoin trading volume", 2.55, "https://www.coingecko.com/en/coins/bitcoin", "crypto", "CoinGecko 24h Bitcoin volume"),
  factor(17, "funding-rates", "Funding Rates", "Perpetual funding rates", 3.4, "https://www.coinglass.com/FundingRate", "derivatives", "Binance BTCUSDT last funding rate. CoinGlass has no keyless API."),
  factor(18, "open-interest", "Open Interest", "Bitcoin open interest", 3.4, "https://www.coinglass.com/open-interest", "derivatives", "Binance BTCUSDT open interest. CoinGlass has no keyless API."),
  factor(19, "exchange-balances", "יתרות ביטקוין בבורסות", "Bitcoin exchange balances", 3.4, "https://cryptoquant.com/", "onchain", "CryptoQuant all-exchange BTC reserve", "CRYPTOQUANT_API_KEY"),
  factor(20, "miner-activity", "פעילות כורי ביטקוין", "Bitcoin miner activity", 1.7, "https://mempool.space/mining", "onchain", "mempool.space hashrate and pool share"),
  factor(21, "cpi", "מדד אינפלציה CPI", "US CPI", 4.25, "https://www.bls.gov/cpi/", "economy", "BLS CPI-U CUUR0000SA0, with FRED CPIAUCSL as fallback"),
  factor(22, "pce", "מדד אינפלציה PCE", "US PCE inflation", 2.55, "https://www.bea.gov/data/personal-consumption-expenditures-price-index", "economy", "FRED PCEPI (BEA). Needs FRED_API_KEY when the CSV download is blocked."),
  factor(23, "employment", "נתוני תעסוקה בארהב", "US employment", 2.55, "https://www.bls.gov/news.release/empsit.htm", "economy", "BLS unemployment rate and nonfarm payrolls, with FRED as fallback"),
  factor(24, "global-liquidity", "נזילות גלובלית", "Global liquidity", 5.1, "https://www.bis.org/statistics/gli.htm", "liquidity", "BIS global liquidity: USD credit to non-banks outside the United States"),
  factor(25, "fed-balance-sheet", "מאזן הפדרל ריזרב", "Federal Reserve balance sheet", 2.55, "https://fred.stlouisfed.org/series/WALCL", "liquidity", "FRED WALCL total assets. Needs FRED_API_KEY when the CSV download is blocked."),
  factor(26, "boj", "מדיניות הבנק המרכזי של יפן", "Bank of Japan policy", 0.85, "https://www.boj.or.jp/en/mopo/mpmdeci/", "economy", "Bank of Japan what's-new feed, plus the FRED call-money rate when FRED_API_KEY is set"),
  factor(27, "china", "כלכלת סין", "China economy", 0.85, "https://www.stats.gov.cn/english/", "economy", "World Bank annual China CPI and real GDP growth. NBS has no stable JSON API."),
  factor(28, "geopolitics", "מלחמות ומשברים גיאופוליטיים", "Wars and geopolitical crises", 2.55, "https://www.gdeltproject.org/", "events", "GDELT DOC 2.0 article volume for war, invasion, sanctions, and conflict"),
  factor(29, "regulation", "רגולציה ואימוץ מוסדי", "Regulation and institutional adoption", 4.25, "https://www.sec.gov/newsroom", "events", "SEC press-release feed"),
  factor(30, "security-incidents", "פריצות ואירועי אבטחה", "Hacks and security incidents", 1.7, "https://rekt.news/", "events", "DefiLlama hack database. rekt.news does not publish a stable feed."),
  factor(31, "exchange-netflows", "זרימות נטו לבורסות Exchange Netflows", "Exchange netflows", 2, "https://cryptoquant.com/", "onchain", "CryptoQuant all-exchange BTC netflow", "CRYPTOQUANT_API_KEY"),
  factor(32, "whale-flows", "פעילות לווייתנים Whale Flows", "Whale flows", 1.5, "https://glassnode.com/", "onchain", "Glassnode whale-to-exchange and exchange-to-whale transfer volume", "GLASSNODE_API_KEY"),
  factor(33, "lth-supply", "היצע מחזיקים לטווח ארוך LTH Supply", "Long-term holder supply", 1.5, "https://studio.glassnode.com/dashboards/btc-supply", "onchain", "Glassnode supply/lth_sum", "GLASSNODE_API_KEY"),
  factor(34, "mvrv", "יחס MVRV", "MVRV", 1.5, "https://onchainlab.net/metrics", "onchain", "Glassnode market/mvrv. onchainlab does not publish an open API.", "GLASSNODE_API_KEY"),
  factor(35, "sopr", "SOPR", "SOPR", 1, "https://onchainlab.net/metrics", "onchain", "Glassnode indicators/sopr", "GLASSNODE_API_KEY"),
  factor(36, "nupl", "NUPL", "NUPL", 1, "https://onchainlab.net/metrics", "onchain", "Glassnode indicators/net_unrealized_profit_loss", "GLASSNODE_API_KEY"),
  factor(37, "active-addresses", "כתובות פעילות ברשת", "Active Bitcoin addresses", 1, "https://www.blockchain.com/explorer/charts", "onchain", "Blockchain.com unique addresses chart"),
  factor(38, "btc-fees-txs", "עמלות ועסקאות ברשת Bitcoin", "Bitcoin fees and transactions", 1, "https://mempool.space/", "onchain", "mempool.space recommended fee and Blockchain.com daily transactions"),
  factor(39, "put-call", "יחס Put Call באופציות ביטקוין", "Bitcoin options put/call ratio", 1, "https://insights.deribit.com/", "derivatives", "Deribit public option book, put open interest divided by call open interest"),
  factor(40, "implied-vol", "תנודתיות גלומה באופציות", "Bitcoin implied volatility", 1, "https://insights.deribit.com/", "derivatives", "Deribit DVOL index"),
  factor(41, "spot-cvd", "Spot CVD לחץ קנייה ומכירה", "Spot CVD", 1, "https://www.coinglass.com/", "derivatives", "Binance spot BTCUSDT taker delta over the latest 1,000 aggregate trades"),
  factor(42, "btc-dominance", "דומיננטיות ביטקוין BTC Dominance", "Bitcoin dominance", 0.5, "https://coinmarketcap.com/charts/bitcoin-dominance/", "crypto", "CoinGecko global market-cap percentage. CoinMarketCap requires a key."),
];

export const WEIGHT_PERCENT_SUM =
  FACTORS.reduce((sum, item) => sum + Math.round(item.weightPercent * 100), 0) / 100;

const byId = new Map(FACTORS.map((item) => [item.id, item]));
const bySlug = new Map(FACTORS.map((item) => [item.slug, item]));

export function factorById(id: number): Factor | undefined {
  return byId.get(id);
}

export function resolveFactor(factor: number | string): Factor | undefined {
  if (typeof factor === "number") return byId.get(factor);
  const asNumber = Number(factor);
  if (Number.isInteger(asNumber) && String(asNumber) === factor.trim()) return byId.get(asNumber);
  return bySlug.get(factor.trim().toLowerCase());
}

export function factorsInGroup(group: GroupId): Factor[] {
  return FACTORS.filter((item) => item.group === group);
}

export function listFactorCatalog(filter?: { group?: GroupId; query?: string }): Factor[] {
  const query = filter?.query?.trim().toLowerCase();
  return FACTORS.filter((item) => {
    if (filter?.group && item.group !== filter.group) return false;
    if (!query) return true;
    return (
      item.slug.includes(query) ||
      item.nameEn.toLowerCase().includes(query) ||
      item.nameHe.toLowerCase().includes(query) ||
      String(item.id) === query
    );
  });
}

export { GROUP_LABELS };
