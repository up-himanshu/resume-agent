import { z } from "zod";

// Contracts live here so the API and the React app share one source of truth.
// Each contract is a Zod schema (runtime validation) plus its inferred type (compile time).
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.object({
    connected: z.boolean(),
    pgvectorVersion: z.string().nullable(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
