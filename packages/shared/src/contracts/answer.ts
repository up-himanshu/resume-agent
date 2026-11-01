import { z } from "zod";
import { GroundingSchema, LlmUsageSchema } from "./extract.js";

export const AskRequestSchema = z.object({
  question: z.string().trim().min(2, "Question is too short").max(500),
  /** How many child chunks to retrieve. They are grouped into their parent entries as sources. */
  k: z.number().int().min(1).max(20).default(6),
});
export type AskRequest = z.input<typeof AskRequestSchema>;

export const AnswerStatusSchema = z.enum(["answered", "partial", "not_in_resume"]);
export type AnswerStatus = z.infer<typeof AnswerStatusSchema>;

/** A resume entry shown to the model as [cN]. Retrieval finds small chunks; the model reads whole entries. */
export const AnswerSourceSchema = z.object({
  sourceId: z.string(),
  section: z.string(),
  /** The entry text the model saw (the parent chunk, or the child when it has no parent). */
  text: z.string(),
  /** The child chunks that retrieval matched inside this entry. */
  matchedChunkIds: z.array(z.uuid()),
  /** Best cross-encoder logit among the matched chunks. */
  rerankScore: z.number().nullable(),
});
export type AnswerSource = z.infer<typeof AnswerSourceSchema>;

export const CitationSchema = z.object({
  sourceId: z.string(),
  /** Verbatim quote from the source that supports the claim. */
  quote: z.string(),
  /** Whether the quote was actually found in that source (same check as extraction evidence). */
  grounding: GroundingSchema,
  span: z.object({ start: z.number(), end: z.number() }).nullable(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ClaimSchema = z.object({
  text: z.string(),
  citations: z.array(CitationSchema),
  /** true when at least one citation's quote was found in its source. */
  supported: z.boolean(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const AskResponseSchema = z.object({
  resumeId: z.uuid(),
  question: z.string(),
  status: AnswerStatusSchema,
  claims: z.array(ClaimSchema),
  /** What the question asks that the sources don't cover (for "partial" and "not_in_resume"). */
  missing: z.string().nullable(),
  sources: z.array(AnswerSourceSchema),
  meta: z.object({
    model: z.string().nullable(),
    attempts: z.number(),
    usage: LlmUsageSchema,
    unsupportedClaims: z.number(),
    timingsMs: z.object({ retrieval: z.number(), generation: z.number(), total: z.number() }),
  }),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;
