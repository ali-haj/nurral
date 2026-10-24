import { FACTORS } from "./catalog.js";
import { loadDotEnv } from "./http.js";
import { readFactors } from "./read.js";

loadDotEnv();

const requested = process.argv.slice(2).map(Number).filter((id) => Number.isInteger(id) && id >= 1 && id <= 42);
const readings = await readFactors(requested.length > 0 ? requested : FACTORS.map((factor) => factor.id), 4);
const counts = { ok: 0, unavailable: 0, error: 0 };
for (const reading of readings) {
  counts[reading.status] += 1;
  const value = reading.value === null ? "" : String(reading.value);
  const detail = reading.note ? ` ${reading.note}` : "";
  console.log(`${String(reading.id).padStart(2, " ")} ${reading.status.padEnd(12)} ${value.padEnd(18)} ${(reading.unit ?? "").padEnd(28)}${detail}`);
}
console.log(`ok=${counts.ok} unavailable=${counts.unavailable} error=${counts.error}`);
