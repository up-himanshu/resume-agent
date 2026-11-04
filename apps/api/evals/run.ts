// Eval runner: pnpm eval [--mode rag|agent|both] [--cases id1,id2] [--no-langfuse]
//
// 1. Calibrate the judge against hand-labelled answers (an untrusted judge fails the run).
// 2. Ingest the golden resume (reused by content hash after the first run).
// 3. Run every golden question through RAG and/or the agent, score each answer
//    (deterministic checks + LLM judge), and aggregate per mode.
// 4. Compare the aggregates with the gates; exit 1 on any failure, so CI can block a merge.
//
// With Langfuse keys, the golden set is synced to a Langfuse dataset and each mode becomes an
// experiment run: every item links to its full trace, with the scores attached, and runs can be
// compared side by side in the UI. Without keys it runs the same way, locally.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { env } from "../src/env.js";
import { sendLogsTo } from "../src/log.js";
import { pool } from "../src/db.js";
import { ingestResume } from "../src/services/ingestion.js";
import { answerQuestion } from "../src/services/answering.js";
import { runAgent } from "../src/agent/agent.js";
import { loadReranker } from "../src/rag/reranker.js";
import { langfuse, shutdownTracing } from "../src/observability/tracing.js";
import { GOLDEN_RESUME_PATH, GOLDEN_SET, type GoldenCase } from "./golden.js";
import { CALIBRATION, judgeAnswer } from "./judge.js";
import {
  byCategory,
  checkGates,
  deterministicScores,
  judgeScore,
  summarize,
  type EvalOutput,
  type GateResult,
  type ItemResult,
  type Mode,
  type Score,
  type Summary,
} from "./scoring.js";

const RAG_K = 6;
const AGENT_MAX_TURNS = 6;
const CONCURRENCY = 4;
const DATASET = "resume-qa-golden";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const resultsDir = fileURLToPath(new URL("./results/", import.meta.url));

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "both" },
    cases: { type: "string" },
    "no-langfuse": { type: "boolean", default: false },
  },
});
const modes: Mode[] = args.mode === "both" ? ["rag", "agent"] : [args.mode as Mode];
if (!modes.every((m) => m === "rag" || m === "agent")) throw new Error(`--mode must be rag, agent or both`);
const wanted = args.cases?.split(",").map((s) => s.trim());
const cases = wanted ? GOLDEN_SET.filter((c) => wanted.includes(c.id)) : GOLDEN_SET;
if (!cases.length) throw new Error(`No golden cases match --cases ${args.cases}`);
const lf = args["no-langfuse"] ? null : langfuse;

// The app's step-by-step logs go to a file; the console shows only eval progress and results.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.mkdirSync(resultsDir, { recursive: true });
const logFile = path.join(resultsDir, `run-${stamp}.log`);
const logStream = fs.createWriteStream(logFile);
sendLogsTo((line) => logStream.write(`${line}\n`));

function gitVersion(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: repoRoot }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: repoRoot }).toString().trim() ? "-dirty" : "";
    return sha + dirty;
  } catch {
    return "unknown";
  }
}
const version = gitVersion();

// ---------- the systems under test ----------

async function runTask(mode: Mode, resumeId: string, question: string): Promise<EvalOutput> {
  const startedAt = performance.now();
  try {
    if (mode === "rag") {
      const r = await answerQuestion(resumeId, question, RAG_K);
      return {
        mode,
        status: r.status,
        claims: r.claims.map((c) => ({ text: c.text, supported: c.supported })),
        missing: r.missing,
        unsupportedClaims: r.meta.unsupportedClaims,
        context: r.sources.map((s) => s.text),
        toolCalls: [],
        turns: 1,
        tokens: { input: r.meta.usage.inputTokens, output: r.meta.usage.outputTokens },
        latencyMs: r.meta.timingsMs.total,
      };
    }
    const r = await runAgent(resumeId, question, AGENT_MAX_TURNS);
    return {
      mode,
      status: r.status,
      claims: r.claims.map((c) => ({ text: c.text, supported: c.supported })),
      missing: r.missing,
      unsupportedClaims: r.meta.unsupportedClaims,
      context: r.toolCalls.map((t) => t.output),
      toolCalls: r.toolCalls.map((t) => `${t.tool}(${JSON.stringify(t.args)})`),
      turns: r.turns.length,
      tokens: { input: r.meta.usage.inputTokens, output: r.meta.usage.outputTokens },
      latencyMs: r.meta.latencyMs,
    };
  } catch (err) {
    // A crash is a result too (scored as task_error), not a reason to abort the whole run.
    return {
      mode,
      status: "error",
      claims: [],
      missing: null,
      unsupportedClaims: 0,
      context: [],
      toolCalls: [],
      turns: 0,
      tokens: { input: 0, output: 0 },
      latencyMs: Math.round(performance.now() - startedAt),
      error: (err as Error).message,
    };
  }
}

const caseById = new Map(GOLDEN_SET.map((c) => [c.id, c]));
const caseOf = (metadata: unknown): GoldenCase => {
  const id = (metadata as { caseId?: string } | undefined)?.caseId;
  const c = id ? caseById.get(id) : undefined;
  if (!c) throw new Error(`Dataset item has unknown caseId "${id}"`);
  return c;
};

function progress(mode: Mode, c: GoldenCase, o: EvalOutput) {
  const mark = o.status === "error" ? "ERROR" : c.expectedStatus.includes(o.status) ? "ok" : "status!";
  console.log(`  [${mode}] ${c.id.padEnd(22)} ${o.status.padEnd(14)} ${(o.latencyMs / 1000).toFixed(1).padStart(5)}s  ${mark}`);
}

// ---------- running a mode: as a Langfuse experiment, or locally ----------

async function syncDataset(): Promise<void> {
  if (!lf) return;
  try {
    await lf.api.datasets.create({ name: DATASET, description: "Golden questions about samples/resume-priya.txt (apps/api/evals/golden.ts)" });
  } catch {
    // already exists
  }
  // Upsert by id: the file in the repo is the source of truth, Langfuse mirrors it.
  await Promise.all(
    GOLDEN_SET.map((c) =>
      lf.dataset.createItem({
        datasetName: DATASET,
        id: `${DATASET}-${c.id}`,
        input: { question: c.question },
        expectedOutput: { status: c.expectedStatus, reference: c.reference, mustMention: c.mustMention, evidence: c.evidence },
        metadata: { caseId: c.id, category: c.category },
      }),
    ),
  );
}

async function runMode(mode: Mode, resumeId: string): Promise<{ items: ItemResult[]; url?: string }> {
  const task = async (item: { input?: unknown; metadata?: unknown }) => {
    const c = caseOf(item.metadata);
    const output = await runTask(mode, resumeId, c.question);
    progress(mode, c, output);
    return output;
  };
  const evaluators = [
    async ({ output, metadata }: { output: EvalOutput; metadata?: unknown }) => deterministicScores(caseOf(metadata), output),
    async ({ output, metadata }: { output: EvalOutput; metadata?: unknown }) => judgeScore(caseOf(metadata), output),
  ];

  if (!lf) {
    const items: ItemResult[] = [];
    const queue = [...cases];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const output = await task({ metadata: { caseId: c.id } });
          const scores = (await Promise.all(evaluators.map((e) => e({ output, metadata: { caseId: c.id } })))).flat();
          items.push({ case: c, output, scores });
        }
      }),
    );
    return { items };
  }

  const dataset = await lf.dataset.get(DATASET);
  const ids = new Set(cases.map((c) => c.id));
  const data = dataset.items.filter((i) => ids.has((i.metadata as { caseId?: string } | null)?.caseId ?? ""));
  const result = await lf.experiment.run({
    name: `resume-qa ${mode}`,
    runName: `${mode} ${env.OPENAI_CHAT_MODEL} ${version} ${stamp}`,
    description: `${mode === "rag" ? `Single-shot RAG, k=${RAG_K}` : `Agent, maxTurns=${AGENT_MAX_TURNS}`}; judge ${env.OPENAI_JUDGE_MODEL}`,
    metadata: { mode, model: env.OPENAI_CHAT_MODEL, judgeModel: env.OPENAI_JUDGE_MODEL, version, k: RAG_K, maxTurns: AGENT_MAX_TURNS },
    data,
    task,
    evaluators,
    // Run-level scores: the aggregates, so runs can be compared in the Langfuse UI.
    runEvaluators: [
      async ({ itemResults }) =>
        Object.entries(summarize(itemResults.map((r) => ({ case: caseOf(r.item.metadata), output: r.output, scores: r.evaluations as Score[] }))))
          .filter(([, v]) => !Number.isNaN(v))
          .map(([name, value]) => ({ name: `avg_${name}`, value, dataType: "NUMERIC" as const })),
    ],
    maxConcurrency: CONCURRENCY,
  });
  const items = result.itemResults.map((r) => ({
    case: caseOf(r.item.metadata),
    output: r.output as EvalOutput,
    scores: r.evaluations as Score[],
    traceId: r.traceId,
  }));
  return { items, url: result.experimentUrl };
}

// ---------- reporting ----------

const fmt = (v: number) => (Number.isNaN(v) ? "n/a" : Number.isInteger(v) ? String(v) : v.toFixed(2));

function printMode(mode: Mode, items: ItemResult[], summary: Summary, gates: GateResult[], url?: string) {
  console.log(`\n=== ${mode.toUpperCase()} (${items.length} cases) ===`);
  for (const g of gates) {
    const rule = g.min !== undefined ? `>= ${g.min}` : `<= ${g.max}`;
    console.log(`  ${g.passed ? "PASS" : "FAIL"}  ${g.metric.padEnd(18)} ${fmt(g.value).padStart(6)}  (gate ${rule})`);
  }
  const extras = ["evidence_mrr", "latency_p50_s", "latency_p95_s", "input_tokens", "output_tokens"];
  console.log(`  info  ${extras.map((m) => `${m}=${fmt(summary[m] ?? NaN)}`).join("  ")}`);
  console.log(`  judge by category: ${Object.entries(byCategory(items)).map(([k, v]) => `${k}=${fmt(v)}`).join("  ")}`);

  // Every imperfect item, with the reason from its score comments: where to look first.
  const problems = items
    .map((i) => ({ i, bad: i.scores.filter((s) => (s.name === "task_error" ? s.value === 1 : s.value < 1) && s.name !== "evidence_mrr") }))
    .filter((p) => p.bad.length);
  if (problems.length) console.log("  imperfect cases:");
  for (const { i, bad } of problems.sort((a, b) => a.i.case.id.localeCompare(b.i.case.id))) {
    console.log(`    - ${i.case.id} (${i.output.status})${i.traceId ? ` trace ${i.traceId}` : ""}`);
    for (const s of bad) console.log(`        ${s.name}=${fmt(s.value)}: ${s.comment ?? ""}`);
  }
  if (url) console.log(`  Langfuse experiment: ${url}`);
}

/** The gates as a Markdown table, for the GitHub Actions job summary page. */
function markdownSummary(report: Record<string, unknown>, judgeAgreement: number): string {
  const lines = [`## Evals (${report.version}, ${report.model}, judge ${report.judgeModel})`, "", `Judge calibration agreement: ${fmt(judgeAgreement)}`, ""];
  for (const [mode, r] of Object.entries(report.modes as Record<string, { gates: GateResult[]; experimentUrl: string | null }>)) {
    lines.push(`### ${mode}${r.experimentUrl ? ` ([Langfuse](${r.experimentUrl}))` : ""}`, "", "| Metric | Value | Gate | |", "|---|---|---|---|");
    for (const g of r.gates) lines.push(`| ${g.metric} | ${fmt(g.value)} | ${g.min !== undefined ? `>= ${g.min}` : `<= ${g.max}`} | ${g.passed ? "✅" : "❌"} |`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- main ----------

async function main(): Promise<number> {
  console.log(`Evals: ${cases.length} golden cases x ${modes.join(" + ")} | model ${env.OPENAI_CHAT_MODEL}, judge ${env.OPENAI_JUDGE_MODEL} | version ${version}`);
  console.log(`App logs: ${logFile}`);
  console.log(lf ? `Recording to Langfuse dataset "${DATASET}".` : "Langfuse off: results stay local.");

  console.log("\nCalibrating the judge against hand-labelled answers...");
  const calibration = await Promise.all(CALIBRATION.map(async (c) => ({ c, got: await judgeAnswer(c) })));
  const disagreements = calibration.filter(({ c, got }) => got.verdict !== c.expected);
  for (const { c, got } of calibration) {
    console.log(`  ${got.verdict === c.expected ? "agree   " : "DISAGREE"} ${c.why}: expected ${c.expected}, judge said ${got.verdict}`);
    if (got.verdict !== c.expected) console.log(`           ${got.reasoning}`);
  }
  const judgeAgreement = 1 - disagreements.length / CALIBRATION.length;

  const resumeText = fs.readFileSync(path.join(repoRoot, GOLDEN_RESUME_PATH), "utf8");
  const { resumeId, reused } = await ingestResume(resumeText);
  console.log(`\nGolden resume ${resumeId} (${reused ? "already indexed" : "indexed now"}).`);
  await loadReranker();
  await syncDataset();

  const report: Record<string, unknown> = { stamp, version, model: env.OPENAI_CHAT_MODEL, judgeModel: env.OPENAI_JUDGE_MODEL, judgeAgreement, modes: {} };
  let failed = disagreements.length > 0;
  for (const mode of modes) {
    console.log(`\nRunning ${mode} on ${cases.length} cases...`);
    const { items, url } = await runMode(mode, resumeId);
    const summary = summarize(items);
    const gates = checkGates(mode, summary);
    printMode(mode, items, summary, gates, url);
    failed ||= gates.some((g) => !g.passed);
    (report.modes as Record<string, unknown>)[mode] = {
      summary,
      gates,
      byCategory: byCategory(items),
      experimentUrl: url ?? null,
      items: items.map((i) => ({ id: i.case.id, category: i.case.category, traceId: i.traceId ?? null, output: { ...i.output, context: undefined }, scores: i.scores })),
    };
  }

  console.log(`\nJudge calibration: ${fmt(judgeAgreement)} agreement (gate: 1)${disagreements.length ? "  FAIL: judge scores are not trustworthy" : ""}`);
  const reportFile = path.join(resultsDir, `report-${stamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  fs.copyFileSync(reportFile, path.join(resultsDir, "latest.json"));
  console.log(`Report: ${reportFile}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary(report, judgeAgreement));
  console.log(failed ? "\nEVALS FAILED: at least one gate is below its threshold." : "\nEVALS PASSED.");
  return failed ? 1 : 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error("Eval run crashed:", err);
} finally {
  await shutdownTracing(); // flush spans and scores before exiting
  await pool.end();
  logStream.end();
}
process.exit(exitCode);
