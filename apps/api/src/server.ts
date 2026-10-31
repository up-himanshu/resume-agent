import express from "express";
import { HealthResponseSchema, type HealthResponse } from "@resume-agent/shared";
import { env } from "./env.js";
import { pool } from "./db.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

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

app.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});
