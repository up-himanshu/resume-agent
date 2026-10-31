import { Router } from "express";
import { ExtractRequestSchema, ExtractResponseSchema } from "@resume-agent/shared";
import { parseOrThrow } from "../http/errors.js";
import { extractProfile } from "../services/extraction.js";

export const extractRouter = Router();

extractRouter.post("/extract", async (req, res) => {
  const { resumeText } = parseOrThrow(ExtractRequestSchema, req.body);
  const result = await extractProfile(resumeText);
  res.json(ExtractResponseSchema.parse(result));
});
