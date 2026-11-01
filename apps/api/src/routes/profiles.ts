import { Router } from "express";
import { SaveProfileRequestSchema, SaveProfileResponseSchema, buildFormSchema, profileForm } from "@resume-agent/shared";
import { HttpError, issuesOf, parseOrThrow } from "../http/errors.js";
import { log } from "../log.js";
import { insertProfile, resumeExists } from "../repositories/profiles.js";

export const profilesRouter = Router();

const formSchema = buildFormSchema(profileForm);

profilesRouter.post("/profiles", async (req, res) => {
  const body = parseOrThrow(SaveProfileRequestSchema, req.body);
  log("profiles", `Received POST /profiles for form "${body.formId}" v${body.formVersion} with ${Object.keys(body.values).length} fields, from resume ${body.resumeId ?? "(none)"}.`);

  // The client sends the config version it rendered. If the form changed since, its values were
  // validated against old rules, so reject rather than store data under the wrong schema.
  if (body.formId !== profileForm.id || body.formVersion !== profileForm.version) {
    throw new HttpError(409, "FORM_VERSION_MISMATCH", `Form is now "${profileForm.id}" v${profileForm.version}; reload and try again`);
  }

  // Never trust client-side validation: run the same config-generated schema on the server.
  const result = formSchema.safeParse(body.values);
  if (!result.success) {
    log("profiles", "Server-side validation FAILED; nothing saved.", issuesOf(result.error));
    throw new HttpError(400, "INVALID_PROFILE", "Profile failed validation", issuesOf(result.error));
  }
  log("profiles", "Server-side validation passed with the same Zod schema the browser uses.");

  if (body.resumeId && !(await resumeExists(body.resumeId))) {
    throw new HttpError(400, "UNKNOWN_RESUME", `Resume ${body.resumeId} does not exist`);
  }

  const row = await insertProfile({
    resumeId: body.resumeId,
    formId: profileForm.id,
    formVersion: profileForm.version,
    data: result.data as Record<string, unknown>,
  });
  log("profiles", `Saved profile ${row.id} (values stored as one jsonb document in table profiles).`);
  res.status(201).json(SaveProfileResponseSchema.parse({ profileId: row.id, savedAt: row.created_at.toISOString() }));
});
