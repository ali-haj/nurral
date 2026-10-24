import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadDotEnv } from "./http.js";
import { createServer } from "./server.js";

loadDotEnv();
serveStdio(createServer);
console.error("nurral MCP server listening on stdio");
