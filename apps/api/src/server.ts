import express from "express";
import { HealthResponseSchema, type HealthResponse } from "@resume-agent/shared";
import { env } from "./env.js";
import { pool } from "./db.js";
import { extractRouter } from "./routes/extract.js";
import { resumesRouter } from "./routes/resumes.js";
import { profilesRouter } from "./routes/profiles.js";
import { mcpRouter } from "./mcp/http.js";
import { feedbackRouter } from "./routes/feedback.js";
import { describeTracing, shutdownTracing } from "./observability/tracing.js";
import { errorHandler } from "./http/errors.js";
import { log, requestContext } from "./log.js";
import { loadReranker } from "./rag/reranker.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(requestContext);
// One line per finished request. /health is polled every 30s by the UI, so it's skipped as noise.
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const startedAt = performance.now();
  res.on("finish", () => {
    log("http", `Finished ${req.method} ${req.path} with status ${res.statusCode} in ${Math.round(performance.now() - startedAt)}ms`);
  });
  next();
});

app.get("/health", async (_req, res) => {
  let body: HealthResponse;
  try {
    const { rows } = await pool.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    const pgvectorVersion = rows[0]?.extversion ?? null;
    body = {
      status: pgvectorVersion ? "ok" : "degraded",
      db: { connected: true, pgvectorVersion },
    };
  } catch {
    body = { status: "degraded", db: { connected: false, pgvectorVersion: null } };
  }
  // Parse our own response against the shared contract so the API can never drift from it.
  res.status(body.status === "ok" ? 200 : 503).json(HealthResponseSchema.parse(body));
});

app.use(extractRouter);
app.use(resumesRouter);
app.use(profilesRouter);
app.use(mcpRouter);
app.use(feedbackRouter);
app.use(errorHandler);

// Express 5 passes bind errors (e.g. EADDRINUSE) to this callback instead of throwing.
app.listen(env.API_PORT, (err) => {
  if (err) {
    console.error(`Failed to start API on port ${env.API_PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`API listening on http://localhost:${env.API_PORT}`);
  console.log(describeTracing());
  // Warm the reranker in the background so the first search doesn't pay the model-load time.
  loadReranker().catch((e) => console.error("Reranker failed to load:", e));
});

// Spans are exported in batches; flush the last batch before the process exits (Ctrl+C, tsx watch restart).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownTracing().finally(() => process.exit(0));
  });
}
