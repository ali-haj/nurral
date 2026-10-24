import { factorById, FACTORS, factorsInGroup } from "./catalog.js";
import { fetcherFor } from "./providers/index.js";
import { errorMessage, reading } from "./providers/shared.js";
import type { FactorReading, GroupId } from "./types.js";

export async function readFactor(id: number): Promise<FactorReading> {
  const factor = factorById(id);
  if (!factor) throw new Error(`Unknown factor ${id}`);
  try {
    return await fetcherFor(factor)(factor);
  } catch (error) {
    return reading(factor, {
      status: "error",
      note: errorMessage(error),
    });
  }
}

export async function readFactors(ids: number[], concurrency = 4): Promise<FactorReading[]> {
  const results = new Array<FactorReading>(ids.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const id = ids[index];
      if (id === undefined) continue;
      results[index] = await readFactor(id);
    }
  });
  await Promise.all(workers);
  return results;
}

export function snapshotIds(options: { ids?: number[]; group?: GroupId }): number[] {
  if (options.group) {
    const inGroup = new Set(factorsInGroup(options.group).map((factor) => factor.id));
    const ids = options.ids?.length ? options.ids.filter((id) => inGroup.has(id)) : [...inGroup];
    return ids;
  }
  if (options.ids?.length) return [...new Set(options.ids)];
  return FACTORS.map((factor) => factor.id);
}
