import { z } from "zod";

/** Link from a response to its Langfuse trace. null when tracing is off. */
export const TraceRefSchema = z.object({ id: z.string(), url: z.string().nullable() });
export type TraceRef = z.infer<typeof TraceRefSchema>;

/** Thumbs up/down on an answer, stored as a score on its trace. */
export const FeedbackRequestSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/, "Not an OpenTelemetry trace id"),
  helpful: z.boolean(),
  comment: z.string().trim().max(1000).nullable().default(null),
});
export type FeedbackRequest = z.input<typeof FeedbackRequestSchema>;
