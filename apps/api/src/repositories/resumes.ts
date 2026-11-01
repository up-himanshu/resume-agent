import type pg from "pg";
import type { Chunk, ResumeSummary } from "@resume-agent/shared";
import { pool } from "../db.js";
import { toPgVector } from "../rag/embeddings.js";

type Db = pg.Pool | pg.PoolClient;

export interface ChunkInsert {
  id: string;
  parentId: string | null;
  kind: "parent" | "child";
  section: string;
  chunkIndex: number;
  content: string;
  sourceText: string;
  charStart: number;
  charEnd: number;
  embedding: number[] | null;
}

export async function findResumeByHash(hash: string, model: string, db: Db = pool) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM resumes WHERE content_hash = $1 AND embedding_model = $2",
    [hash, model],
  );
  return rows[0]?.id ?? null;
}

/** Returns the new id, or null if another request inserted the same resume first. */
export async function insertResume(db: Db, content: string, hash: string, model: string) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO resumes (content, content_hash, embedding_model) VALUES ($1, $2, $3)
     ON CONFLICT (content_hash, embedding_model) DO NOTHING
     RETURNING id`,
    [content, hash, model],
  );
  return rows[0]?.id ?? null;
}

/** One multi-row INSERT for all chunks. Parents come first so children's parent_id FKs resolve. */
export async function insertChunks(db: Db, resumeId: string, chunks: ChunkInsert[]) {
  const cols = 11;
  const values: unknown[] = [];
  const tuples = chunks.map((c, i) => {
    values.push(
      c.id, resumeId, c.parentId, c.kind, c.section, c.chunkIndex, c.content, c.sourceText,
      c.charStart, c.charEnd, c.embedding ? toPgVector(c.embedding) : null,
    );
    return `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(", ")})`;
  });
  await db.query(
    `INSERT INTO resume_chunks
       (id, resume_id, parent_id, kind, section, chunk_index, content, source_text, char_start, char_end, embedding)
     VALUES ${tuples.join(",\n")}`,
    values,
  );
}

export async function countChunks(resumeId: string, db: Db = pool) {
  const { rows } = await db.query<{ kind: "parent" | "child"; n: number }>(
    "SELECT kind, count(*)::int AS n FROM resume_chunks WHERE resume_id = $1 GROUP BY kind",
    [resumeId],
  );
  return {
    parents: rows.find((r) => r.kind === "parent")?.n ?? 0,
    children: rows.find((r) => r.kind === "child")?.n ?? 0,
  };
}

export async function listChunks(resumeId: string, db: Db = pool): Promise<Chunk[] | null> {
  const exists = await db.query("SELECT 1 FROM resumes WHERE id = $1", [resumeId]);
  if (!exists.rowCount) return null;
  const { rows } = await db.query(
    `SELECT id, parent_id, kind, section, chunk_index, content, source_text, char_start, char_end,
            embedding IS NOT NULL AS has_embedding
     FROM resume_chunks WHERE resume_id = $1 ORDER BY chunk_index`,
    [resumeId],
  );
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind,
    section: r.section,
    chunkIndex: r.chunk_index,
    content: r.content,
    sourceText: r.source_text,
    charStart: r.char_start,
    charEnd: r.char_end,
    hasEmbedding: r.has_embedding,
  }));
}

/** Saved resumes for the picker, newest first. Label prefers what the user confirmed in a saved profile. */
export async function listResumes(db: Db = pool): Promise<ResumeSummary[]> {
  const { rows } = await db.query<{
    id: string;
    created_at: Date;
    embedding_model: string;
    head: string;
    profile_name: string | null;
    child_chunks: number;
    profile_count: number;
  }>(
    `SELECT r.id, r.created_at, r.embedding_model, left(r.content, 300) AS head,
            (SELECT nullif(p.data->>'fullName', '') FROM profiles p
              WHERE p.resume_id = r.id ORDER BY p.created_at DESC LIMIT 1) AS profile_name,
            (SELECT count(*)::int FROM resume_chunks c WHERE c.resume_id = r.id AND c.kind = 'child') AS child_chunks,
            (SELECT count(*)::int FROM profiles p WHERE p.resume_id = r.id) AS profile_count
     FROM resumes r
     ORDER BY r.created_at DESC
     LIMIT 100`,
  );
  return rows.map((r) => {
    const firstLine = r.head.split("\n").map((l) => l.trim()).find(Boolean) ?? "Untitled resume";
    return {
      resumeId: r.id,
      label: r.profile_name ?? (firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine),
      createdAt: r.created_at.toISOString(),
      embeddingModel: r.embedding_model,
      childChunks: r.child_chunks,
      profileCount: r.profile_count,
    };
  });
}

export async function getResumeContent(resumeId: string, db: Db = pool): Promise<string | null> {
  const { rows } = await db.query<{ content: string }>("SELECT content FROM resumes WHERE id = $1", [resumeId]);
  return rows[0]?.content ?? null;
}

/** Whole entries (parent chunks) per section, in resume order. Used when an agent needs a full section, not top-k. */
export async function listEntries(resumeId: string, db: Db = pool) {
  const { rows } = await db.query<{ section: string; source_text: string }>(
    `SELECT section, source_text FROM resume_chunks
     WHERE resume_id = $1 AND kind = 'parent' ORDER BY chunk_index`,
    [resumeId],
  );
  return rows.map((r) => ({ section: r.section, text: r.source_text }));
}
