import assert from "node:assert/strict";
import test from "node:test";
import { FACTORS, WEIGHT_PERCENT_SUM } from "./catalog.js";
import { FETCHERS } from "./providers/index.js";

test("catalog has the 42 factors in order", () => {
  assert.equal(FACTORS.length, 42);
  assert.deepEqual(
    FACTORS.map((factor) => factor.id),
    Array.from({ length: 42 }, (_, index) => index + 1),
  );
  assert.equal(new Set(FACTORS.map((factor) => factor.slug)).size, 42);
});

test("weights sum to the listed 98.15", () => {
  assert.equal(WEIGHT_PERCENT_SUM, 98.15);
});

test("every factor has a fetcher", () => {
  for (const factor of FACTORS) assert.equal(typeof FETCHERS[factor.id], "function");
});
