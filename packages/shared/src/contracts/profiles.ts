import { z } from "zod";

export const SaveProfileRequestSchema = z.object({
  /** The resume the suggestions came from, if any (data lineage). */
  resumeId: z.uuid().nullable(),
  formId: z.string(),
  formVersion: z.number().int(),
  /** Validated on the server against the form schema; the client's validation isn't trusted. */
  values: z.record(z.string(), z.unknown()),
});
export type SaveProfileRequest = z.infer<typeof SaveProfileRequestSchema>;

export const SaveProfileResponseSchema = z.object({
  profileId: z.uuid(),
  savedAt: z.string(),
});
export type SaveProfileResponse = z.infer<typeof SaveProfileResponseSchema>;
