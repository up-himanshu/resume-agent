import { Router } from "express";
import { z } from "zod";
import {
  ChunkListResponseSchema,
  IngestRequestSchema,
  IngestResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
} from "@resume-agent/shared";
import { HttpError, parseOrThrow } from "../http/errors.js";
import { log } from "../log.js";
import { listChunks } from "../repositories/resumes.js";
import { resumeExists } from "../repositories/profiles.js";
import { hybridSearch } from "../rag/retrieval.js";
import { ingestResume } from "../services/ingestion.js";

export const resumesRouter = Router();

resumesRouter.post("/resumes", async (req, res) => {
  const { resumeText } = parseOrThrow(IngestRequestSchema, req.body);
  log("route", `Received POST /resumes: index a ${resumeText.length}-char resume for question answering.`);
  res.json(IngestResponseSchema.parse(await ingestResume(resumeText)));
});

resumesRouter.get("/resumes/:id/chunks", async (req, res) => {
  const { id } = parseOrThrow(z.object({ id: z.uuid() }), req.params);
  const chunks = await listChunks(id);
  if (!chunks) throw new HttpError(404, "NOT_FOUND", `Resume ${id} not found`);
  res.json(ChunkListResponseSchema.parse({ resumeId: id, chunks }));
});

// Retrieval on its own (no LLM answer yet): shows what each stage of hybrid search returns.
resumesRouter.post("/resumes/:id/search", async (req, res) => {
  const { id } = parseOrThrow(z.object({ id: z.uuid() }), req.params);
  const { query, k, rerank } = parseOrThrow(SearchRequestSchema, req.body);
  if (!(await resumeExists(id))) throw new HttpError(404, "NOT_FOUND", `Resume ${id} not found`);
  res.json(SearchResponseSchema.parse(await hybridSearch(id, query, { k, rerank })));
});
