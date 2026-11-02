import type { SearchHit, SearchResponse } from "@resume-agent/shared";
import { pool } from "../db.js";
import { log } from "../log.js";
import { embedTexts, toPgVector } from "./embeddings.js";
import { rerankScores } from "./reranker.js";
import { traceStep } from "../observability/tracing.js";

// Hybrid retrieval: two first-stage retrievers with different strengths, fused, then reranked.
//   vector  - meaning ("led a team" ~ "mentored engineers"), weak on exact names/terms
//   keyword - exact terms ("Kubernetes", "Brightline"), blind to synonyms and paraphrase
// Reciprocal Rank Fusion merges the two lists using only ranks (their scores aren't comparable),
// then a cross-encoder reorders the short fused list by reading query and chunk together.

const RRF_K = 60; // standard constant from the RRF paper; damps the advantage of rank 1 vs rank 2

interface Row {
  id: string;
  parent_id: string | null;
  section: string;
  content: string;
  source_text: string;
  char_start: number;
  char_end: number;
  score: number;
}

const CHUNK_COLUMNS = "id, parent_id, section, content, source_text, char_start, char_end";

async function vectorSearch(resumeId: string, queryVector: number[], limit: number): Promise<Row[]> {
  // <=> is pgvector's cosine DISTANCE (0 = same direction). Similarity = 1 - distance.
  const { rows } = await pool.query<Row>(
    `SELECT ${CHUNK_COLUMNS}, 1 - (embedding <=> $2) AS score
     FROM resume_chunks
     WHERE resume_id = $1 AND kind = 'child'
     ORDER BY embedding <=> $2
     LIMIT $3`,
    [resumeId, toPgVector(queryVector), limit],
  );
  return rows;
}

async function keywordSearch(resumeId: string, query: string, limit: number): Promise<{ rows: Row[]; tsquery: string }> {
  // Turn the question into stemmed lexemes, OR them together (AND would demand every word appear),
  // and rank by ts_rank_cd (how many query terms match and how close together they are).
  // Note: this is NOT true BM25. ts_rank has no IDF (rare words aren't weighted up) and weaker
  // length normalization. Real BM25 in Postgres needs an extension such as ParadeDB's pg_search.
  const { rows } = await pool.query<Row & { tsquery: string }>(
    `WITH q AS (
       SELECT to_tsquery('simple', coalesce(nullif(array_to_string(array(
         SELECT quote_literal(lexeme) FROM unnest(tsvector_to_array(to_tsvector('english', $2))) AS lexeme
       ), ' | '), ''), '''''')) AS query
     )
     SELECT ${CHUNK_COLUMNS}, ts_rank_cd(search_tsv, q.query) AS score, q.query::text AS tsquery
     FROM resume_chunks, q
     WHERE resume_id = $1 AND kind = 'child' AND search_tsv @@ q.query
     ORDER BY score DESC
     LIMIT $3`,
    [resumeId, query, limit],
  );
  const tsq = await pool.query<{ q: string }>(
    `SELECT array_to_string(tsvector_to_array(to_tsvector('english', $1)), ' | ') AS q`,
    [query],
  );
  return { rows, tsquery: tsq.rows[0]?.q ?? "" };
}

async function parentTexts(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query<{ id: string; source_text: string }>(
    "SELECT id, source_text FROM resume_chunks WHERE id = ANY($1)",
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.source_text]));
}

const preview = (s: string) => (s.length > 90 ? `${s.slice(0, 87)}...` : s).replace(/\s+/g, " ");

export interface SearchOptions {
  k: number;
  rerank: boolean;
  /** How many results each first-stage retriever contributes before fusion. */
  candidates?: number;
}

export function hybridSearch(resumeId: string, query: string, opts: SearchOptions): Promise<SearchResponse> {
  return traceStep(
    "hybrid-search",
    {
      asType: "retriever",
      input: { query, ...opts },
      // The trace shows what was retrieved and how it scored, not the full debug payload.
      output: (r) => r.results.map((h) => ({ section: h.section, text: h.sourceText, rerank: h.scores.rerank?.score ?? null, rrfRank: h.scores.rrf.rank })),
      metadata: { resumeId },
    },
    () => runHybridSearch(resumeId, query, opts),
  );
}

async function runHybridSearch(resumeId: string, query: string, opts: SearchOptions): Promise<SearchResponse> {
  const scope = "retrieve";
  const candidates = opts.candidates ?? 10;
  const t0 = performance.now();
  log(scope, `Hybrid search for "${query}" in resume ${resumeId}: top ${candidates} from vector search + top ${candidates} from keyword search, fused with RRF${opts.rerank ? ", reranked by the cross-encoder" : ""}, keep ${opts.k}.`);

  const { vectors } = await embedTexts([query], scope);
  const tEmbed = performance.now();

  // Two parallel child spans: the trace's timeline shows they overlap.
  const preview3 = (rows: Row[]) => rows.map((r) => ({ score: Number(r.score), text: preview(r.content) }));
  const [vectorRows, keyword] = await Promise.all([
    traceStep("vector-search", { input: { candidates }, output: preview3 }, () => vectorSearch(resumeId, vectors[0]!, candidates)),
    traceStep("keyword-search", { input: { candidates }, output: (k) => ({ lexemes: k.tsquery, hits: preview3(k.rows) }) }, () =>
      keywordSearch(resumeId, query, candidates),
    ),
  ]);
  const tSearch = performance.now();
  log(scope, `Vector search (cosine similarity, higher = closer in meaning) returned ${vectorRows.length}:`,
    vectorRows.map((r, i) => `#${i + 1} sim=${Number(r.score).toFixed(3)}  ${preview(r.content)}`).join("\n"));
  log(scope, `Keyword search for lexemes [${keyword.tsquery}] (OR-ed) returned ${keyword.rows.length}:`,
    keyword.rows.length ? keyword.rows.map((r, i) => `#${i + 1} rank=${Number(r.score).toFixed(3)}  ${preview(r.content)}`).join("\n") : "(no chunk contains any of these words)");

  // Reciprocal Rank Fusion: score(chunk) = sum over lists of 1 / (RRF_K + rank in that list).
  const byId = new Map<string, Row>();
  const fusedScore = new Map<string, number>();
  const vectorRank = new Map<string, { rank: number; score: number }>();
  const keywordRank = new Map<string, { rank: number; score: number }>();
  vectorRows.forEach((r, i) => {
    byId.set(r.id, r);
    vectorRank.set(r.id, { rank: i + 1, score: Number(r.score) });
    fusedScore.set(r.id, (fusedScore.get(r.id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  keyword.rows.forEach((r, i) => {
    byId.set(r.id, r);
    keywordRank.set(r.id, { rank: i + 1, score: Number(r.score) });
    fusedScore.set(r.id, (fusedScore.get(r.id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  const fused = [...fusedScore.entries()].sort((a, b) => b[1] - a[1]);
  log(scope, `RRF fused ${fused.length} unique chunks (a chunk found by both searches scores higher):`,
    fused.map(([id, s], i) => `#${i + 1} rrf=${s.toFixed(4)} vector#${vectorRank.get(id)?.rank ?? "-"} keyword#${keywordRank.get(id)?.rank ?? "-"}  ${preview(byId.get(id)!.content)}`).join("\n"));

  let ordered = fused.map(([id, score], i) => ({ id, rrf: { rank: i + 1, score } }));
  const rerankInfo = new Map<string, { rank: number; score: number }>();
  let tRerank: number | null = null;
  if (opts.rerank && ordered.length) {
    const r0 = performance.now();
    const docs = ordered.map((o) => byId.get(o.id)!.content);
    const scores = await traceStep(
      "cross-encoder-rerank",
      { input: { pairs: docs.length }, output: (s) => s.map((x, i) => ({ logit: Math.round(x * 100) / 100, text: preview(docs[i]!) })) },
      () => rerankScores(query, docs),
    );
    tRerank = performance.now() - r0;
    const reranked = ordered.map((o, i) => ({ ...o, rerankScore: scores[i]! })).sort((a, b) => b.rerankScore - a.rerankScore);
    reranked.forEach((o, i) => rerankInfo.set(o.id, { rank: i + 1, score: o.rerankScore }));
    ordered = reranked;
    log(scope, `Cross-encoder scored ${scores.length} (query, chunk) pairs in ${Math.round(tRerank)}ms. Scores are raw logits: higher = more relevant, above 0 = model thinks it answers the query. New order:`,
      reranked.map((o, i) => `#${i + 1} rerank=${o.rerankScore.toFixed(2)} (was rrf#${o.rrf.rank})  ${preview(byId.get(o.id)!.content)}`).join("\n"));
  }

  const top = ordered.slice(0, opts.k);
  const parents = await parentTexts([...new Set(top.map((o) => byId.get(o.id)!.parent_id).filter((p): p is string => Boolean(p)))]);
  const results: SearchHit[] = top.map((o) => {
    const r = byId.get(o.id)!;
    return {
      chunkId: r.id,
      parentId: r.parent_id,
      section: r.section,
      content: r.content,
      sourceText: r.source_text,
      charStart: r.char_start,
      charEnd: r.char_end,
      parentText: r.parent_id ? (parents.get(r.parent_id) ?? null) : null,
      scores: {
        vector: vectorRank.get(o.id) ?? null,
        keyword: keywordRank.get(o.id) ?? null,
        rrf: o.rrf,
        rerank: rerankInfo.get(o.id) ?? null,
      },
    };
  });

  const timingsMs = {
    embedQuery: Math.round(tEmbed - t0),
    search: Math.round(tSearch - tEmbed),
    rerank: tRerank === null ? null : Math.round(tRerank),
    total: Math.round(performance.now() - t0),
  };
  log(scope, `Returning top ${results.length}, each with its parent chunk (the whole entry) attached for context. Timings: ${JSON.stringify(timingsMs)}.`);

  const list = (m: Map<string, { rank: number; score: number }>) =>
    [...m.entries()].sort((a, b) => a[1].rank - b[1].rank).map(([id, v]) => ({ chunkId: id, ...v, preview: preview(byId.get(id)!.source_text) }));
  return {
    resumeId,
    query,
    results,
    debug: {
      keywordLexemes: keyword.tsquery,
      vector: list(vectorRank),
      keyword: list(keywordRank),
      fused: fused.map(([id, score], i) => ({ chunkId: id, rank: i + 1, score, preview: preview(byId.get(id)!.source_text) })),
      timingsMs,
    },
  };
}
