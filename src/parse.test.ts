import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBisCsv,
  parseBls,
  parseCamecoPrices,
  parseFarsideFlows,
  parseFlowCell,
  parseFredCsv,
  parseTreasuryCurves,
  parseYahooChart,
} from "./parse.js";

test("parses parenthesized fund flows as negative", () => {
  assert.equal(parseFlowCell("(74.5)"), -74.5);
  assert.equal(parseFlowCell("122.0"), 122);
  assert.equal(parseFlowCell("-"), null);
});

test("parses the treasury yield curve", () => {
  const xml = `
    <m:properties>
      <d:NEW_DATE m:type="Edm.DateTime">2026-10-22T00:00:00</d:NEW_DATE>
      <d:BC_2YEAR m:type="Edm.Double">4.65</d:BC_2YEAR>
      <d:BC_10YEAR m:type="Edm.Double">4.96</d:BC_10YEAR>
    </m:properties>
    <m:properties>
      <d:NEW_DATE m:type="Edm.DateTime">2026-10-23T00:00:00</d:NEW_DATE>
      <d:BC_2YEAR m:type="Edm.Double">4.69</d:BC_2YEAR>
      <d:BC_10YEAR m:type="Edm.Double">5.00</d:BC_10YEAR>
    </m:properties>`;
  const curves = parseTreasuryCurves(xml);
  assert.equal(curves.length, 2);
  assert.equal(curves[1]?.date, "2026-10-23");
  assert.equal(curves[1]?.yields["10Y"], 5);
  assert.equal(curves[1]?.yields["2Y"], 4.69);
});

test("parses a Farside flow row and its total", () => {
  const html = `
    <table class="etf">
      <thead><tr><th> </th><th>IBIT</th><th>Total</th></tr></thead>
      <tbody>
        <tr><td>05 Oct 2026</td><td>69.9</td><td><span class="redFont">(89.8)</span></td></tr>
        <tr><td>06 Oct 2026</td><td>122.0</td><td>32.2</td></tr>
      </tbody>
    </table>`;
  const rows = parseFarsideFlows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.total, -89.8);
  assert.equal(rows[0]?.issuers.IBIT, 69.9);
  assert.equal(rows[1]?.total, 32.2);
});

test("parses the latest Cameco spot row", () => {
  const html = `
    <tr>
      <td class="views-field views-field-field-monthly-date">2026/08/31</td>
      <td class="views-field views-field-field-spot-price">86.38</td>
      <td class="views-field views-field-field-long-term-price">96.50</td>
    </tr>
    <tr>
      <td class="views-field views-field-field-monthly-date">2026/09/30</td>
      <td class="views-field views-field-field-spot-price">89.63</td>
      <td class="views-field views-field-field-long-term-price"></td>
    </tr>`;
  const rows = parseCamecoPrices(html);
  assert.equal(rows.at(-1)?.date, "2026-09-30");
  assert.equal(rows.at(-1)?.spot, 89.63);
  assert.equal(rows.at(-1)?.longTerm, null);
});

test("parses FRED and BIS csv rows", () => {
  assert.deepEqual(parseFredCsv("DATE,WALCL\n2026-10-15,6500000\n2026-10-22,.\n"), [
    { time: "2026-10-15", value: 6500000 },
  ]);
  const bis = parseBisCsv(
    'FREQ,TIME_PERIOD,OBS_VALUE,UNIT_MULT,TITLE\nQ,2026-Q1,14747653.746,6,"USD credit, outside the US"\n',
  );
  assert.equal(bis[0]?.period, "2026-Q1");
  assert.equal(bis[0]?.value, 14747653.746);
  assert.equal(bis[0]?.unitMult, 6);
  assert.equal(bis[0]?.title, "USD credit, outside the US");
});

test("parses a BLS series newest-first into time order", () => {
  const points = parseBls({
    status: "REQUEST_SUCCEEDED",
    Results: {
      series: [{
        seriesID: "CUUR0000SA0",
        data: [
          { year: "2026", period: "M09", value: "323.0" },
          { year: "2026", period: "M08", value: "321.5" },
          { year: "2026", period: "M13", value: "999" },
        ],
      }],
    },
  });
  assert.deepEqual(points.map((point) => point.time), ["2026-08-01", "2026-09-01"]);
});

test("parses a Yahoo chart price", () => {
  const quote = parseYahooChart({
    chart: {
      result: [{
        meta: { regularMarketPrice: 101.75, regularMarketTime: 1792789199, chartPreviousClose: 101.98, currency: "USD" },
        timestamp: [1792700000, 1792789199],
        indicators: { quote: [{ close: [101.2, 101.75] }] },
      }],
    },
  });
  assert.equal(quote.price, 101.75);
  assert.equal(quote.closes.length, 2);
  assert.ok(quote.changePercent !== null && quote.changePercent < 0);
});
