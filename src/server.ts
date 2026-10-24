import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { GROUP_LABELS, listFactorCatalog, resolveFactor, WEIGHT_PERCENT_SUM } from "./catalog.js";
import { round } from "./http.js";
import { readFactor, readFactors, snapshotIds } from "./read.js";
import { GROUP_IDS, type GroupId } from "./types.js";

const groupSchema = z.enum(GROUP_IDS);

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "nurral", version: "0.1.0" });

  server.registerTool(
    "list_factors",
    {
      title: "List factors",
      description:
        "List the 42 weighted Bitcoin macro factors, their Hebrew and English names, weights, cited source pages, and where the live reading comes from. Call this before get_factor if you do not already know the id or slug. Weights sum to 98.15 and are not rescaled.",
      inputSchema: z.object({
        group: groupSchema.optional().describe("Optional group: liquidity, risk, crypto, derivatives, onchain, economy, or events"),
        query: z.string().optional().describe("Optional match against id, slug, English name, or Hebrew name"),
      }),
    },
    async ({ group, query }) => {
      const factors = listFactorCatalog({ group, query });
      return text({
        weightPercentSum: WEIGHT_PERCENT_SUM,
        weightNote: "Listed weights sum to 98.15. They are stored as given and are not renormalized to 100.",
        groups: GROUP_LABELS,
        count: factors.length,
        factors: factors.map((factor) => ({
          id: factor.id,
          slug: factor.slug,
          nameHe: factor.nameHe,
          nameEn: factor.nameEn,
          weightPercent: factor.weightPercent,
          group: factor.group,
          citedSource: factor.citedSource,
          liveSource: factor.liveSource,
          requiresEnv: factor.requiresEnv ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "get_factor",
    {
      title: "Get one factor",
      description:
        "Fetch the current reading for one factor by id (1-42) or slug. Returns the value, unit, as-of time, a short series when the source provides one, and the URL that was actually called. Factors 19 and 31 need CRYPTOQUANT_API_KEY. Factors 32-36 need GLASSNODE_API_KEY. A missing key returns status unavailable rather than a guessed number.",
      inputSchema: z.object({
        factor: z
          .union([z.number().int().min(1).max(42), z.string().min(1)])
          .describe("Factor id from 1 to 42, or a slug such as dxy or btc-etf-flows"),
      }),
    },
    async ({ factor }) => {
      const found = resolveFactor(factor);
      if (!found) return failure(`Unknown factor "${factor}". Call list_factors to see ids and slugs.`);
      return text(await readFactor(found.id));
    },
  );

  server.registerTool(
    "get_snapshot",
    {
      title: "Get a factor snapshot",
      description:
        "Fetch many factors in parallel. Omit both arguments for all 42. The first full snapshot can take up to a minute; repeats within a few minutes are cached. Each row keeps its own status, so a paid source without a key does not fail the rest. This tool returns the readings and weight coverage. It does not turn them into a buy or sell score.",
      inputSchema: z.object({
        ids: z.array(z.number().int().min(1).max(42)).max(42).optional().describe("Factor ids to fetch. Defaults to every factor, or every factor in group."),
        group: groupSchema.optional().describe("Restrict the snapshot to one group"),
      }),
    },
    async ({ ids, group }) => {
      const selected = snapshotIds({ ids, group: group as GroupId | undefined });
      if (selected.length === 0) return failure("No factors matched that id list and group.");
      const factors = await readFactors(selected, 4);
      const coverage = (status: "ok" | "unavailable" | "error") =>
        round(factors.filter((factor) => factor.status === status).reduce((sum, factor) => sum + factor.weightPercent, 0), 2);
      return text({
        fetchedAt: new Date().toISOString(),
        weightPercentSum: WEIGHT_PERCENT_SUM,
        weightPercentOk: coverage("ok"),
        weightPercentUnavailable: coverage("unavailable"),
        weightPercentError: coverage("error"),
        counts: {
          ok: factors.filter((factor) => factor.status === "ok").length,
          unavailable: factors.filter((factor) => factor.status === "unavailable").length,
          error: factors.filter((factor) => factor.status === "error").length,
        },
        factors,
      });
    },
  );

  return server;
}
