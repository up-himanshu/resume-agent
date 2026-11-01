import { z } from "zod";

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(2, "Query is too short").max(500),
  k: z.number().int().min(1).max(20).default(5),
  rerank: z.boolean().default(true),
});
export type SearchRequest = z.input<typeof SearchRequestSchema>;

const RankScore = z.object({ rank: z.number(), score: z.number() });

export const SearchHitSchema = z.object({
  chunkId: z.uuid(),
  parentId: z.uuid().nullable(),
  section: z.string(),
  /** The embedded text (with context header). */
  content: z.string(),
  /** Exact resume text, for citations. */
  sourceText: z.string(),
  charStart: z.number(),
  charEnd: z.number(),
  /** The whole entry this chunk belongs to: the context given to the model. */
  parentText: z.string().nullable(),
  scores: z.object({
    vector: RankScore.nullable(),
    keyword: RankScore.nullable(),
    rrf: RankScore,
    rerank: RankScore.nullable(),
  }),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

const RankedSchema = RankScore.extend({ chunkId: z.uuid(), preview: z.string() });

export const SearchResponseSchema = z.object({
  resumeId: z.uuid(),
  query: z.string(),
  results: z.array(SearchHitSchema),
  /** Each stage's ranking, to see what hybrid search and reranking changed. */
  debug: z.object({
    keywordLexemes: z.string(),
    vector: z.array(RankedSchema),
    keyword: z.array(RankedSchema),
    fused: z.array(RankedSchema),
    timingsMs: z.object({
      embedQuery: z.number(),
      search: z.number(),
      rerank: z.number().nullable(),
      total: z.number(),
    }),
  }),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
