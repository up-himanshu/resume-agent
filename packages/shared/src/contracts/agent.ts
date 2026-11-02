import { TraceRefSchema } from "./trace.js";
import { z } from "zod";
import { AnswerStatusSchema, ClaimSchema } from "./answer.js";
import { LlmUsageSchema } from "./extract.js";

export const AgentRequestSchema = z.object({
  question: z.string().trim().min(2, "Question is too short").max(500),
  /** Hard cap on model turns. Each turn may call several tools at once. */
  maxTurns: z.number().int().min(2, "The agent needs at least one turn to gather evidence and one to answer").max(10).default(6),
});
export type AgentRequest = z.input<typeof AgentRequestSchema>;

/** One tool call the agent made. Its id (t1, t2, ...) is what citations point to. */
export const AgentToolCallSchema = z.object({
  id: z.string(),
  turn: z.number(),
  tool: z.string(),
  /** Arguments the model chose (resumeId is injected by the server and not shown to the model). */
  args: z.record(z.string(), z.unknown()),
  /** Text the model received back. */
  output: z.string(),
  isError: z.boolean(),
  /** true when the model repeated an earlier identical call and got the cached result. */
  duplicate: z.boolean(),
  latencyMs: z.number(),
});
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const AgentTurnSchema = z.object({
  turn: z.number(),
  /** "tools": the model asked for tool calls; "answer": it gave the final answer; "repair": its answer failed validation. */
  action: z.enum(["tools", "answer", "repair"]),
  toolCallIds: z.array(z.string()),
  latencyMs: z.number(),
  usage: LlmUsageSchema,
});
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export const AgentStopReasonSchema = z.enum(["answered", "turn_limit"]);

export const AgentResponseSchema = z.object({
  resumeId: z.uuid(),
  question: z.string(),
  status: AnswerStatusSchema,
  /** Citation sourceIds are tool call ids (t1, t2, ...); quotes are verified against that call's output. */
  claims: z.array(ClaimSchema),
  missing: z.string().nullable(),
  toolCalls: z.array(AgentToolCallSchema),
  turns: z.array(AgentTurnSchema),
  trace: TraceRefSchema.nullable(),
  meta: z.object({
    model: z.string(),
    stopReason: AgentStopReasonSchema,
    unsupportedClaims: z.number(),
    usage: LlmUsageSchema,
    latencyMs: z.number(),
  }),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
