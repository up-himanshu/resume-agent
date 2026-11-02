import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sendLogsToStderr } from "../log.js";
import { loadReranker } from "../rag/reranker.js";
import { createMcpServer } from "./server.js";
import { describeTracing, shutdownTracing } from "../observability/tracing.js";

// stdio transport: the host (Claude Desktop, Claude Code, the Inspector, our agent) starts this
// process and talks JSON-RPC over its stdin/stdout. One process = one client. No network port,
// no auth needed: whoever can start the process already has access.
//
// stdout belongs to the protocol, so every log line must go to stderr.
sendLogsToStderr();

const server = createMcpServer();
await server.connect(new StdioServerTransport());
console.error("resume-agent MCP server running on stdio");
console.error(describeTracing());
// The host ends a stdio server by closing stdin; flush buffered spans before exiting.
process.stdin.on("close", () => void shutdownTracing().finally(() => process.exit(0)));
// Warm the cross-encoder so the first search_resume call doesn't pay the model-load time.
loadReranker().catch((e) => console.error("Reranker failed to load:", e));
