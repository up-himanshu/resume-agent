import { Router } from "express";
import { FeedbackRequestSchema } from "@resume-agent/shared";
import { parseOrThrow } from "../http/errors.js";
import { log } from "../log.js";
import { score, tracingEnabled } from "../observability/tracing.js";

export const feedbackRouter = Router();

// User feedback becomes a score on the answer's trace. In Langfuse you can then filter for
// thumbs-down answers and open exactly what the model saw: the cheapest source of eval cases.
feedbackRouter.post("/feedback", (req, res) => {
  const { traceId, helpful, comment } = parseOrThrow(FeedbackRequestSchema, req.body);
  log("route", `User feedback on trace ${traceId}: ${helpful ? "helpful" : "NOT helpful"}${comment ? ` ("${comment}")` : ""}.`);
  score(traceId, "user_feedback", helpful ? 1 : 0, { dataType: "BOOLEAN", comment: comment ?? undefined });
  res.status(tracingEnabled ? 202 : 204).end();
});
