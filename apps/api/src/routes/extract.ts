import { Router } from "express";
import { ExtractRequestSchema, ExtractResponseSchema } from "@resume-agent/shared";
import { parseOrThrow } from "../http/errors.js";
import { extractSuggestions } from "../services/extraction.js";

export const extractRouter = Router();

extractRouter.post("/extract", async (req, res) => {
  const { resumeText, strategy } = parseOrThrow(ExtractRequestSchema, req.body);
  const result = await extractSuggestions(resumeText, strategy);
  res.json(ExtractResponseSchema.parse(result));
});
