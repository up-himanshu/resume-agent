// Minimal migration runner: applies db/migrations/*.sql in filename order, once each.
// Run: pnpm db:migrate
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const dir = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);
const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
const applied = new Set(rows.map((r) => r.name));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`Already applied: ${file}`);
    continue;
  }
  const client = await pool.connect();
  try {
    // One transaction per file: a failing migration leaves no half-created tables behind.
    await client.query("BEGIN");
    await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`Applied: ${file}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Failed: ${file}. Rolled back.`);
    throw err;
  } finally {
    client.release();
  }
}

await pool.end();
