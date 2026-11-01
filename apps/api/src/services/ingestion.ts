import { createHash, randomUUID } from "node:crypto";
import type { IngestResponse } from "@resume-agent/shared";
import { pool } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";
import { CHUNKING, chunkResume } from "../rag/chunker.js";
import { EMBEDDING_DIMENSIONS, embedTexts } from "../rag/embeddings.js";
import { countChunks, findResumeByHash, insertChunks, insertResume, type ChunkInsert } from "../repositories/resumes.js";

const SCOPE = "ingest";

export async function ingestResume(resumeText: string): Promise<IngestResponse> {
  const model = env.OPENAI_EMBEDDING_MODEL;
  const hash = createHash("sha256").update(resumeText).digest("hex");
  log(SCOPE, `STEP 1/5: Fingerprinted the resume (sha256 ${hash.slice(0, 12)}...). Checking whether this exact text was already indexed with "${model}".`);

  const existing = await findResumeByHash(hash, model);
  if (existing) {
    const chunkCounts = await countChunks(existing);
    log(SCOPE, `Already indexed as resume ${existing} (${chunkCounts.parents} parents, ${chunkCounts.children} children). Reusing it: no chunking, no embedding cost.`);
    return { resumeId: existing, reused: true, chunkCounts, embedding: null };
  }

  const drafts = chunkResume(resumeText);
  const parents = drafts.filter((c) => c.kind === "parent");
  const children = drafts.filter((c) => c.kind === "child");
  log(
    SCOPE,
    `STEP 2/5: Chunked the resume into ${parents.length} parent chunks (whole entries, e.g. one job) and ${children.length} child chunks ` +
      `(single bullets, or windows of at most ${CHUNKING.maxChildChars} chars overlapping by ${CHUNKING.overlapChars}). Only children get embedded. Sections found: ${[...new Set(drafts.map((c) => c.section))].join(", ")}.`,
    drafts.map((c) => `${c.key.padEnd(4)} ${c.kind.padEnd(6)} parent=${(c.parentKey ?? "-").padEnd(4)} [${c.section}] chars ${c.charStart}-${c.charEnd}: ${JSON.stringify(c.content.length > 110 ? `${c.content.slice(0, 107)}...` : c.content)}`).join("\n"),
  );

  // Embed BEFORE opening the transaction: never hold DB locks while waiting on a network call.
  log(SCOPE, `STEP 3/5: Embedding the ${children.length} child chunks. Each child's text includes a context header (section > entry), so the vector knows which job a bullet belongs to.`);
  const embedding = await embedTexts(children.map((c) => c.content), SCOPE);

  // App-generated UUIDs let us set parent_id on children without a round trip per parent.
  const ids = new Map(drafts.map((c) => [c.key, randomUUID()]));
  const vectorByKey = new Map(children.map((c, i) => [c.key, embedding.vectors[i]!]));
  const rows: ChunkInsert[] = drafts.map((c) => ({
    id: ids.get(c.key)!,
    parentId: c.parentKey ? ids.get(c.parentKey)! : null,
    kind: c.kind,
    section: c.section,
    chunkIndex: c.index,
    content: c.content,
    sourceText: c.sourceText,
    charStart: c.charStart,
    charEnd: c.charEnd,
    embedding: vectorByKey.get(c.key) ?? null,
  }));

  log(SCOPE, `STEP 4/5: Writing 1 resume row and ${rows.length} chunk rows in a single transaction (all or nothing).`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resumeId = await insertResume(client, resumeText, hash, model);
    if (!resumeId) {
      // Another request indexed the same resume between our check and our insert.
      await client.query("ROLLBACK");
      const raced = (await findResumeByHash(hash, model))!;
      log(SCOPE, `Another request indexed this resume at the same moment; using its id ${raced} and discarding our copy.`);
      return { resumeId: raced, reused: true, chunkCounts: await countChunks(raced), embedding: null };
    }
    await insertChunks(client, resumeId, rows);
    await client.query("COMMIT");
    log(SCOPE, `STEP 5/5: Committed. Resume ${resumeId} is indexed and searchable. You can see it in pgAdmin: tables resumes and resume_chunks.`);
    return {
      resumeId,
      reused: false,
      chunkCounts: { parents: parents.length, children: children.length },
      embedding: { model: embedding.model, dimensions: EMBEDDING_DIMENSIONS, tokens: embedding.tokens, latencyMs: embedding.latencyMs },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    log(SCOPE, "Database write failed; rolled back, so nothing was saved.");
    throw err;
  } finally {
    client.release();
  }
}
