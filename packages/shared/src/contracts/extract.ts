import { z } from "zod";

export const ExtractionStrategySchema = z.enum(["per-section", "single"]);
export type ExtractionStrategy = z.infer<typeof ExtractionStrategySchema>;

export const ExtractRequestSchema = z.object({
  resumeText: z.string().trim().min(50, "Resume text is too short").max(50_000, "Resume text is too long"),
  // "per-section" runs one model call per form section in parallel; "single" uses one call for all.
  strategy: ExtractionStrategySchema.default("per-section"),
});
export type ExtractRequest = z.input<typeof ExtractRequestSchema>;

export const GroundingSchema = z.enum([
  "exact", // evidence found verbatim in the resume
  "normalized", // found after normalizing case, whitespace, dashes and quotes
  "not_found", // the model quoted text that isn't in the resume: likely hallucinated
  "missing", // the model gave no evidence
]);
export type Grounding = z.infer<typeof GroundingSchema>;

export const SuggestionSchema = z.object({
  /** Stable id for review state, e.g. "email", "skills[3]", "workExperience[0]". */
  id: z.string(),
  fieldName: z.string(),
  sectionId: z.string(),
  kind: z.enum(["field", "tagItem", "groupItem"]),
  /** Already converted to the form's value shape, ready for setValue(). */
  value: z.unknown(),
  evidence: z.string().nullable(),
  /** Character offsets of the evidence in the submitted resume text, for highlighting. */
  evidenceSpan: z.object({ start: z.number(), end: z.number() }).nullable(),
  grounding: GroundingSchema,
  modelConfidence: z.number(),
  /** Model confidence adjusted by the grounding check. */
  confidence: z.number(),
  /** Form-schema validation problems with this value (the user can still edit and accept). */
  issues: z.array(z.string()),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const LlmUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export const ExtractResponseSchema = z.object({
  formId: z.string(),
  suggestions: z.array(SuggestionSchema),
  meta: z.object({
    model: z.string(),
    strategy: ExtractionStrategySchema,
    latencyMs: z.number(),
    usage: LlmUsageSchema,
    calls: z.array(
      z.object({
        group: z.string(),
        attempts: z.number(),
        latencyMs: z.number(),
        usage: LlmUsageSchema,
        /** Set when this group's call failed; other groups' suggestions are still returned. */
        error: z.string().nullable(),
      }),
    ),
  }),
});
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
