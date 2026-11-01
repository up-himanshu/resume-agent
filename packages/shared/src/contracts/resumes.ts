import { z } from "zod";

export const IngestRequestSchema = z.object({
  resumeText: z.string().trim().min(50, "Resume text is too short").max(50_000, "Resume text is too long"),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestResponseSchema = z.object({
  resumeId: z.uuid(),
  /** true when this exact resume was already indexed with the same embedding model. */
  reused: z.boolean(),
  chunkCounts: z.object({ parents: z.number(), children: z.number() }),
  /** null when reused: no embedding call was made. */
  embedding: z
    .object({ model: z.string(), dimensions: z.number(), tokens: z.number(), latencyMs: z.number() })
    .nullable(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

export const ChunkSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: z.enum(["parent", "child"]),
  section: z.string(),
  chunkIndex: z.number(),
  content: z.string(),
  sourceText: z.string(),
  charStart: z.number(),
  charEnd: z.number(),
  hasEmbedding: z.boolean(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const ChunkListResponseSchema = z.object({
  resumeId: z.uuid(),
  chunks: z.array(ChunkSchema),
});
export type ChunkListResponse = z.infer<typeof ChunkListResponseSchema>;

/** One row in the saved-resume picker. */
export const ResumeSummarySchema = z.object({
  resumeId: z.uuid(),
  /** Latest saved profile's fullName, else the resume's first non-empty line. */
  label: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  embeddingModel: z.string(),
  childChunks: z.number(),
  profileCount: z.number(),
});
export type ResumeSummary = z.infer<typeof ResumeSummarySchema>;

export const ResumeListResponseSchema = z.object({ resumes: z.array(ResumeSummarySchema) });
export type ResumeListResponse = z.infer<typeof ResumeListResponseSchema>;
