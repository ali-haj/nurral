import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 25_000;

export class HttpError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface FetchOptions {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  ttlMs?: number;
  timeoutMs?: number;
  /** Retry through the system curl when a host answers with a bot challenge. */
  curlFallback?: boolean;
}

interface CacheEntry {
  expires: number;
  value: Promise<string>;
}

const cache = new Map<string, CacheEntry>();

export function loadDotEnv(): void {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function publicUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of ["api_key", "apiKey", "x_cg_demo_api_key", "x_cg_pro_api_key"]) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:api_key|apiKey)=)[^&]+/gi, "$1REDACTED");
  }
}

export async function getText(url: string, options: FetchOptions = {}): Promise<string> {
  const method = options.method ?? "GET";
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const key = `${method} ${url} ${options.body ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const pending = requestText(url, options);
  cache.set(key, { expires: Date.now() + ttlMs, value: pending });
  try {
    return await pending;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function requestText(url: string, options: FetchOptions): Promise<string> {
  const headers = new Headers(options.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", "nurral-mcp/0.1 (market-data research)");
  if (!headers.has("accept")) headers.set("accept", "*/*");

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (options.curlFallback) return curlText(url);
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(`Request failed for ${publicUrl(url)}: ${message}`);
  }

  const text = await response.text();
  if (options.curlFallback && (response.status === 403 || response.status === 503 || isBotChallenge(text))) {
    return curlText(url);
  }
  if (!response.ok) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new HttpError(`${response.status} ${response.statusText} for ${publicUrl(url)}${snippet ? `: ${snippet}` : ""}`, response.status);
  }
  return text;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function isBotChallenge(text: string): boolean {
  return /Just a moment|cf-browser-verification|Attention Required/i.test(text.slice(0, 2000));
}

function curlText(url: string): Promise<string> {
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  const args = [
    "-sS",
    "-L",
    "--compressed",
    "--max-time",
    "25",
    "-A",
    BROWSER_UA,
    "-H",
    "Accept: text/html,application/json,*/*",
    "-w",
    "\n%{http_code}",
    url,
  ];
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(new HttpError(`curl failed for ${publicUrl(url)}: ${error.message}`));
        return;
      }
      const lines = stdout.split("\n");
      const status = Number(lines.pop());
      const body = lines.join("\n");
      if (!Number.isInteger(status) || status < 100) {
        reject(new HttpError(`curl returned no status for ${publicUrl(url)}`));
        return;
      }
      if (status >= 400) {
        const snippet = body.replace(/\s+/g, " ").trim().slice(0, 180);
        reject(new HttpError(`${status} for ${publicUrl(url)}${snippet ? `: ${snippet}` : ""}`, status));
        return;
      }
      if (!body || isBotChallenge(body)) {
        reject(new HttpError(`Blocked while reading ${publicUrl(url)}`, status));
        return;
      }
      resolve(body);
    });
  });
}

export async function getJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await getText(url, options);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    throw new HttpError(`Expected JSON from ${publicUrl(url)} but received HTML`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`Invalid JSON from ${publicUrl(url)}`);
  }
}

export function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
