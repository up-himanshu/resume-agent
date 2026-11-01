import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { log } from "../log.js";
import { createMcpServer } from "./server.js";

// Streamable HTTP transport: MCP over a single endpoint. The client POSTs JSON-RPC messages; the
// server replies with JSON or an SSE stream (for progress and server-to-client messages).
//
// Stateless mode (sessionIdGenerator: undefined): a fresh server + transport per request, no
// session to keep in memory. Our tools are pure reads, so nothing needs to survive between calls,
// and any API instance behind a load balancer can serve any request. Stateful mode (session ids)
// is for servers that push notifications or keep per-client state.
export const mcpRouter = Router();

mcpRouter.post("/mcp", async (req, res) => {
  const message = req.body as { method?: string } | undefined;
  log("mcp/http", `MCP request over HTTP: ${message?.method ?? "(batch or unknown)"}`);
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  // express.json() already parsed the body, so pass it in rather than letting the transport re-read the stream.
  await transport.handleRequest(req, res, req.body);
});

// GET opens a server-to-client SSE stream and DELETE ends a session; neither exists without sessions.
const methodNotAllowed = (_req: unknown, res: import("express").Response) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless, use POST" },
    id: null,
  });
};
mcpRouter.get("/mcp", methodNotAllowed);
mcpRouter.delete("/mcp", methodNotAllowed);
