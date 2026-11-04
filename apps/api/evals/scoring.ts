import type { AnswerStatus } from "@resume-agent/shared";
import type { GoldenCase } from "./golden.js";
import { judgeAnswer } from "./judge.js";

// Per-item scores, aggregation and the CI gates. Deterministic checks first (free, exact, never
// flaky); the LLM judge only for what code can't decide.

export type Mode = "rag" | "agent";

/** What a task returns: the answer plus the context it was built from, compact enough to store on the trace. */
export interface EvalOutput {
  mode: Mode;
  status: AnswerStatus | "error";
  claims: Array<{ text: string; supported: boolean }>;
  missing: string | null;
  unsupportedClaims: number;
  /** RAG: retrieved source entries in rank order. Agent: tool outputs in call order. */
  context: string[];
  toolCalls: string[];
  turns: number;
  tokens: { input: number; output: number };
  latencyMs: number;
  error?: string;
}

/** Same shape as a Langfuse score, so these go straight onto the item's trace. */
export interface Score {
  name: string;
  value: number;
  dataType: "NUMERIC" | "BOOLEAN";
  comment?: string;
}

/** Compare text the way a person would: ignore dash style, line breaks and spacing. */
export function normalize(text: string): string {
  return text
    .replace(/\\n/g, " ") // tool outputs are JSON, where line breaks are escaped
    .replace(/[‒-―]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const answerText = (o: EvalOutput) => o.claims.map((c) => c.text).join(" ");

/** The free checks: status, required facts, forbidden content, citation grounding, evidence retrieval. */
export function deterministicScores(c: GoldenCase, o: EvalOutput): Score[] {
  if (o.status === "error") {
    return [{ name: "task_error", value: 1, dataType: "BOOLEAN", comment: o.error }];
  }
  const text = answerText(o);
  const scores: Score[] = [];

  scores.push({
    name: "status_ok",
    value: c.expectedStatus.includes(o.status) ? 1 : 0,
    dataType: "BOOLEAN",
    comment: `got "${o.status}", expected ${c.expectedStatus.join(" or ")}`,
  });

  if (c.mustMention.length) {
    const missed = c.mustMention.filter((p) => !new RegExp(p, "i").test(text));
    scores.push({
      name: "facts_coverage",
      value: 1 - missed.length / c.mustMention.length,
      dataType: "NUMERIC",
      comment: missed.length ? `missing: ${missed.join(" ; ")}` : "all required facts present",
    });
  }

  if (c.mustNotMention.length) {
    const hits = c.mustNotMention.filter((p) => new RegExp(p, "i").test(text));
    scores.push({
      name: "no_forbidden",
      value: hits.length ? 0 : 1,
      dataType: "BOOLEAN",
      comment: hits.length ? `forbidden content: ${hits.join(" ; ")}` : undefined,
    });
  }

  // Every claim's quote was already checked against its source by the app itself (Steps 6/8).
  scores.push({
    name: "grounded",
    value: o.unsupportedClaims === 0 ? 1 : 0,
    dataType: "BOOLEAN",
    comment: `${o.unsupportedClaims} of ${o.claims.length} claims unsupported`,
  });

  if (c.evidence.length) {
    const context = o.context.map(normalize);
    const found = c.evidence.filter((e) => context.some((ctx) => ctx.includes(normalize(e))));
    // Recall: did the model get to SEE what it needed? A wrong answer with recall 1 is a generation
    // problem; with recall 0 it's a retrieval problem. That split is the point of measuring both.
    scores.push({
      name: "evidence_recall",
      value: found.length / c.evidence.length,
      dataType: "NUMERIC",
      comment: `${found.length}/${c.evidence.length} evidence lines in ${o.mode === "rag" ? "retrieved sources" : "tool outputs"}`,
    });
    if (o.mode === "rag") {
      // MRR: 1/rank of the first source holding any evidence. Rank matters: models favour early context.
      const rank = context.findIndex((ctx) => c.evidence.some((e) => ctx.includes(normalize(e))));
      scores.push({ name: "evidence_mrr", value: rank === -1 ? 0 : 1 / (rank + 1), dataType: "NUMERIC", comment: rank === -1 ? "not retrieved" : `first hit at rank ${rank + 1}` });
    }
  }
  return scores;
}

export async function judgeScore(c: GoldenCase, o: EvalOutput): Promise<Score[]> {
  if (o.status === "error") return [];
  const result = await judgeAnswer({ question: c.question, reference: c.reference, status: o.status, answer: answerText(o), missing: o.missing });
  return [{ name: "judge_correctness", value: result.score, dataType: "NUMERIC", comment: `${result.verdict}: ${result.reasoning}` }];
}

// ---------- aggregation and gates ----------

export interface ItemResult {
  case: GoldenCase;
  output: EvalOutput;
  scores: Score[];
  traceId?: string;
}

export type Summary = Record<string, number>;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
}

/** Mean of every score over the items that have it, plus errors, latency and token totals. */
export function summarize(items: ItemResult[]): Summary {
  const byName = new Map<string, number[]>();
  for (const item of items) for (const s of item.scores) byName.set(s.name, [...(byName.get(s.name) ?? []), s.value]);
  const summary: Summary = {};
  for (const [name, values] of byName) if (name !== "task_error") summary[name] = mean(values);
  const latencies = items.map((i) => i.output.latencyMs);
  summary.task_errors = items.filter((i) => i.output.status === "error").length;
  summary.latency_p50_s = percentile(latencies, 50) / 1000;
  summary.latency_p95_s = percentile(latencies, 95) / 1000;
  summary.input_tokens = items.reduce((a, i) => a + i.output.tokens.input, 0);
  summary.output_tokens = items.reduce((a, i) => a + i.output.tokens.output, 0);
  return summary;
}

/** Judge score per category: where a mode is weak (RAG on aggregate questions, say). */
export function byCategory(items: ItemResult[]): Record<string, number> {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const judge = item.scores.find((s) => s.name === "judge_correctness");
    if (judge) groups.set(item.case.category, [...(groups.get(item.case.category) ?? []), judge.value]);
  }
  return Object.fromEntries([...groups].map(([k, v]) => [k, mean(v)]));
}

export interface Gate {
  metric: string;
  min?: number;
  max?: number;
}

/**
 * The CI thresholds. A gate on an aggregate, never on one case: LLM output varies run to run, so a
 * single flaky case shouldn't block a merge, but a drop across the set should. Safety gates are
 * absolute (no forbidden content, no task errors). RAG gates are lower on purpose: it can't answer
 * questions that need a whole section, which is why the agent exists.
 * Set from two baseline runs (2026-11-02: RAG judge 0.85/0.85, agent 0.97/1.0), one case's worth of
 * slack below them (1 of 17 = 0.06), and raised as the system improves (a ratchet).
 */
export const GATES: Record<Mode, Gate[]> = {
  rag: [
    { metric: "task_errors", max: 0 },
    { metric: "no_forbidden", min: 1 },
    { metric: "status_ok", min: 0.8 },
    { metric: "grounded", min: 0.9 },
    { metric: "facts_coverage", min: 0.75 },
    { metric: "evidence_recall", min: 0.75 },
    { metric: "judge_correctness", min: 0.7 },
  ],
  agent: [
    { metric: "task_errors", max: 0 },
    { metric: "no_forbidden", min: 1 },
    { metric: "status_ok", min: 0.9 },
    { metric: "grounded", min: 0.9 },
    { metric: "facts_coverage", min: 0.95 },
    { metric: "evidence_recall", min: 0.95 },
    { metric: "judge_correctness", min: 0.9 },
  ],
};

export interface GateResult extends Gate {
  value: number;
  passed: boolean;
}

export function checkGates(mode: Mode, summary: Summary): GateResult[] {
  return GATES[mode].map((g) => {
    const value = summary[g.metric] ?? NaN;
    // NaN: no case in this run has the metric (e.g. a --cases subset). Not applicable, not a failure.
    const passed = Number.isNaN(value) || ((g.min === undefined || value >= g.min) && (g.max === undefined || value <= g.max));
    return { ...g, value, passed };
  });
}
