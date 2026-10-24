# nurral

MCP server for the 42 weighted Bitcoin macro factors. Each factor keeps the Hebrew name, the weight, and the source page from the list. The tool calls a machine-readable feed for that series.

The listed weights sum to **98.15**. They are not rescaled to 100.

## Tools

- `list_factors` returns the catalog: id, slug, names, weight, cited page, and the feed that is actually called.
- `get_factor` fetches one factor by id (`1`–`42`) or slug (`dxy`, `btc-etf-flows`).
- `get_snapshot` fetches every factor, or a group, in parallel. A missing paid key does not blank out the rest.

Readings are data. The server does not turn them into a buy or sell score.

## Run

```bash
npm install
npm test
npm run build
npm start
```

`npm start` speaks MCP over stdio and waits for a client. Logs go to stderr.

This project already has `.cursor/mcp.json`. Build first, then enable the `nurral` server in Cursor. Optional keys go in `.env` (see `.env.example`) or in the MCP server env block.

Check the live feeds with:

```bash
npm run smoke
```

## Where each number comes from

Many of the pages in the list are websites, not JSON APIs. The catalog field `liveSource` names the feed that was called. `citedSource` stays the page you listed.

| Ids | Live without a key | Needs a key |
| --- | --- | --- |
| 1, 4–9, 11 | Yahoo Finance chart. Silver, copper, gas, and wheat are the front-month futures because LBMA, LME, EIA, and CME do not offer an open price API. | `EIA_API_KEY` adds Henry Hub beside the gas future |
| 2 | US Treasury daily yield curve. The headline value is the 10-year; the full curve is in `detail`. | |
| 3 | New York Fed effective fed funds rate and target range | |
| 10 | Cameco month-end uranium spot table | |
| 12–13, 16, 42 | CoinGecko. Dominance is CoinGecko's share of total crypto market cap. | Optional `COINGECKO_DEMO_API_KEY` or `COINGECKO_PRO_API_KEY` |
| 14 | Farside US spot Bitcoin ETF table, US$ millions. Outflows are negative. | |
| 15, 30 | DefiLlama stablecoin supply and hack database. rekt.news has no stable feed. | |
| 17–18, 41 | Binance BTCUSDT funding, open interest, and the taker delta of the latest 1,000 spot prints. CoinGlass is paid and is not called. | |
| 19, 31 | | `CRYPTOQUANT_API_KEY` for all-exchange reserve and netflow |
| 20, 37–38 | mempool.space and Blockchain.com | |
| 21, 23 | BLS CPI-U, unemployment, and nonfarm payrolls | `BLS_API_KEY` if the public endpoint is busy. `FRED_API_KEY` is the fallback. |
| 22, 25 | FRED CSV for PCE and the Fed balance sheet (`WALCL`, reported in trillions) | `FRED_API_KEY` when the CSV host resets the connection |
| 24 | BIS global liquidity: USD credit to non-banks outside the United States, in trillions. Quarterly. | |
| 26 | Bank of Japan notice feed | `FRED_API_KEY` adds the Japan call-money rate |
| 27 | World Bank annual China CPI and real GDP growth. NBS has no stable JSON API. | |
| 28–29 | GDELT article volume, SEC press releases | |
| 32–36 | | `GLASSNODE_API_KEY` for whale flows, LTH supply, MVRV, SOPR, and NUPL |

Groups for `get_snapshot`: `liquidity`, `risk`, `crypto`, `derivatives`, `onchain`, `economy`, `events`.
