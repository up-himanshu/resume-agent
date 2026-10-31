import { z } from "zod";

export const ExtractRequestSchema = z.object({
  resumeText: z.string().trim().min(50, "Resume text is too short").max(50_000, "Resume text is too long"),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

// "YYYY-MM" or "YYYY". Normalizing dates here keeps the form layer simple.
const PartialDate = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/);

export const WorkExperienceSchema = z
  .object({
    company: z.string(),
    title: z.string(),
    location: z.string().nullable(),
    startDate: PartialDate.nullable(),
    endDate: PartialDate.nullable(),
    isCurrent: z.boolean(),
    highlights: z.array(z.string()),
  })
  // A cross-field rule JSON Schema can't express, so the model can't be forced to follow it
  // by constrained decoding. Zod catches it after the call and triggers a repair retry.
  .refine((w) => !(w.isCurrent && w.endDate), {
    message: "A current role must have endDate = null",
    path: ["endDate"],
  });
export type WorkExperience = z.infer<typeof WorkExperienceSchema>;

// What the model must return. Every field is required-but-nullable rather than optional:
// "null" is an explicit "not found in the resume", which strict structured outputs require
// and which is easier to reason about than a missing key.
export const ExtractedProfileSchema = z.object({
  fullName: z.string().nullable(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  headline: z.string().nullable(),
  currentJobTitle: z.string().nullable(),
  skills: z.array(z.string()),
  workExperience: z.array(WorkExperienceSchema),
});
export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;

export const LlmUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
});

export const ExtractResponseSchema = z.object({
  profile: ExtractedProfileSchema,
  meta: z.object({
    model: z.string(),
    attempts: z.number().int(),
    latencyMs: z.number(),
    usage: LlmUsageSchema,
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
