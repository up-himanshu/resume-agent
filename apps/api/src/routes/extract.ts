import { Router } from "express";
import { ExtractRequestSchema, ExtractResponseSchema } from "@resume-agent/shared";
import { parseOrThrow } from "../http/errors.js";
import { log, logBlock } from "../log.js";
import { extractSuggestions } from "../services/extraction.js";
import { traceRef, withTrace } from "../observability/tracing.js";

export const extractRouter = Router();

extractRouter.post("/extract", async (req, res) => {
  const rawText = typeof req.body?.resumeText === "string" ? req.body.resumeText : "";
  log("route", `STEP 1/6: Received POST /extract from the UI. Resume text is ${rawText.length} characters; strategy requested: ${req.body?.strategy ?? "(none, will default)"}.`);

  const { resumeText, strategy } = parseOrThrow(ExtractRequestSchema, req.body);
  log("route", `STEP 2/6: Request body passed Zod validation (resume is 50 to 50,000 chars after trimming). Using strategy "${strategy}".`);
  logBlock("route", "Resume text as received", resumeText);

  // One trace per extraction. traceRef() runs inside it, so the response can link to its own trace.
  const result = await withTrace("extract-profile", { tags: ["extraction", strategy], input: { resumeText, strategy } }, async () => ({
    ...(await extractSuggestions(resumeText, strategy)),
    trace: await traceRef(),
  }));

  // Validate our own response against the shared contract before sending it.
  const body = ExtractResponseSchema.parse(result);
  log("route", `STEP 6/6: Response matches the shared contract. Sending ${body.suggestions.length} suggestions back to the UI (${JSON.stringify(body).length} bytes of JSON).`);
  res.json(body);
});
