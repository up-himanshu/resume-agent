import { Router } from "express";
import { z } from "zod";
import {
  AgentRequestSchema,
  AgentResponseSchema,
  AskRequestSchema,
  AskResponseSchema,
  ChunkListResponseSchema,
  IngestRequestSchema,
  IngestResponseSchema,
  ResumeListResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
} from "@resume-agent/shared";
import { HttpError, parseOrThrow } from "../http/errors.js";
import { log } from "../log.js";
import { listChunks, listResumes } from "../repositories/resumes.js";
import { resumeExists } from "../repositories/profiles.js";
import { hybridSearch } from "../rag/retrieval.js";
import { ingestResume } from "../services/ingestion.js";
import { answerQuestion } from "../services/answering.js";
import { runAgent } from "../agent/agent.js";
import { traceRef, withTrace } from "../observability/tracing.js";

export const resumesRouter = Router();

resumesRouter.post("/resumes", async (req, res) => {
  const { resumeText } = parseOrThrow(IngestRequestSchema, req.body);
  log("route", `Received POST /resumes: index a ${resumeText.length}-char resume for question answering.`);
  const result = await withTrace("ingest-resume", { tags: ["ingestion"], input: { chars: resumeText.length } }, () => ingestResume(resumeText));
  res.json(IngestResponseSchema.parse(result));
});

// Saved resumes for the picker, so a stored resume can be searched and questioned without re-pasting it.
resumesRouter.get("/resumes", async (_req, res) => {
  const resumes = await listResumes();
  log("route", `GET /resumes: ${resumes.length} saved resume(s).`);
  res.json(ResumeListResponseSchema.parse({ resumes }));
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
  const result = await withTrace("search", { sessionId: id, tags: ["retrieval"], input: { query, k, rerank } }, () => hybridSearch(id, query, { k, rerank }));
  res.json(SearchResponseSchema.parse(result));
});

// RAG: retrieval + a cited answer from the model, with every citation verified.
resumesRouter.post("/resumes/:id/ask", async (req, res) => {
  const { id } = parseOrThrow(z.object({ id: z.uuid() }), req.params);
  const { question, k } = parseOrThrow(AskRequestSchema, req.body);
  if (!(await resumeExists(id))) throw new HttpError(404, "NOT_FOUND", `Resume ${id} not found`);
  log("route", `Received POST /resumes/${id}/ask: "${question}"`);
  // sessionId = resume id: every question about one resume is grouped as one session in Langfuse.
  const result = await withTrace("rag-answer", { sessionId: id, tags: ["rag"], input: { question, k } }, async () => ({
    ...(await answerQuestion(id, question, k)),
    trace: await traceRef(),
  }));
  res.json(AskResponseSchema.parse(result));
});

// Agentic RAG: the model drives retrieval through MCP tools in a bounded loop.
resumesRouter.post("/resumes/:id/agent", async (req, res) => {
  const { id } = parseOrThrow(z.object({ id: z.uuid() }), req.params);
  const { question, maxTurns } = parseOrThrow(AgentRequestSchema, req.body);
  if (!(await resumeExists(id))) throw new HttpError(404, "NOT_FOUND", `Resume ${id} not found`);
  log("route", `Received POST /resumes/${id}/agent: "${question}"`);
  const result = await withTrace("agent-answer", { sessionId: id, tags: ["agent"], input: { question, maxTurns } }, async () => ({
    ...(await runAgent(id, question, maxTurns)),
    trace: await traceRef(),
  }));
  res.json(AgentResponseSchema.parse(result));
});
