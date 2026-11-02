import { memo, useState, type FormEvent } from "react";
import type { AgentResponse, AskResponse } from "@resume-agent/shared";
import { useAgent, useAsk } from "../api/hooks.js";
import { AnswerView } from "./AnswerView.js";

type Mode = "rag" | "agent";

const EXAMPLES = [
  "Where has this person led a team?",
  "What was the longest job?",
  "How many years of total experience?",
  "Do they know Kubernetes?",
];

const args = (a: Record<string, unknown>) =>
  Object.entries(a).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");

function RagAnswer({ data }: { data: AskResponse }) {
  return (
    <AnswerView
      question={data.question}
      status={data.status}
      claims={data.claims}
      missing={data.missing}
      unsupportedClaims={data.meta.unsupportedClaims}
      trace={data.trace}
      sourcesLabel="Sources the model saw"
      sources={data.sources.map((s) => ({
        id: s.sourceId,
        title: <><strong>[{s.sourceId}] {s.section}</strong> · {s.matchedChunkIds.length} matched chunk(s) · best rerank {s.rerankScore?.toFixed(2) ?? "–"}</>,
        text: s.text,
      }))}
      stats={<>Single-shot RAG · {data.meta.model ?? "no model call"} · retrieval {data.meta.timingsMs.retrieval}ms · generation {data.meta.timingsMs.generation}ms · {data.meta.usage.inputTokens} in / {data.meta.usage.outputTokens} out tokens</>}
    />
  );
}

function AgentAnswer({ data }: { data: AgentResponse }) {
  const byId = new Map(data.toolCalls.map((t) => [t.id, t]));
  return (
    <AnswerView
      question={data.question}
      status={data.status}
      claims={data.claims}
      missing={data.missing}
      unsupportedClaims={data.meta.unsupportedClaims}
      trace={data.trace}
      sourcesLabel="Tool results the agent read"
      sources={data.toolCalls.map((t) => ({
        id: t.id,
        title: <><strong>[{t.id}] {t.tool}</strong>({args(t.args)}){t.duplicate ? " · duplicate, served from cache" : ""} · {t.latencyMs}ms</>,
        text: t.output,
        isError: t.isError,
      }))}
      stats={<>Agent · {data.meta.model} · {data.turns.length} turn(s) · {data.toolCalls.length} tool call(s) · stopped: {data.meta.stopReason} · {data.meta.latencyMs}ms · {data.meta.usage.inputTokens} in / {data.meta.usage.outputTokens} out tokens</>}
    >
      {/* The trace: what the agent decided at each turn. */}
      <ol className="trace">
        {data.turns.map((turn) => (
          <li key={turn.turn}>
            <span className="muted">Turn {turn.turn} · {turn.latencyMs}ms · </span>
            {turn.action === "tools" && turn.toolCallIds.map((id) => {
              const t = byId.get(id)!;
              return <span key={id} className={`badge ${t.isError ? "bad" : ""}`}>{id} {t.tool}({args(t.args)})</span>;
            })}
            {turn.action === "answer" && <span className="badge good">final answer</span>}
            {turn.action === "repair" && <span className="badge bad">answer failed validation, repaired</span>}
          </li>
        ))}
      </ol>
    </AnswerView>
  );
}

/** Q&A in two modes: one retrieval then one answer (RAG), or a tool-calling loop (agent). */
export const AskPanel = memo(function AskPanel({ resumeId }: { resumeId: string }) {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("agent");
  const ask = useAsk(resumeId);
  const agent = useAgent(resumeId);
  const active = mode === "rag" ? ask : agent;

  const submit = (question: string) => {
    if (question.trim().length < 2) return;
    active.mutate(question.trim());
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  return (
    <div className="search-panel">
      <div className="actions mode-toggle" role="radiogroup" aria-label="Answer mode">
        <label className="checkbox-label inline">
          <input type="radio" checked={mode === "agent"} onChange={() => setMode("agent")} /> Agent (multi-step, tools)
        </label>
        <label className="checkbox-label inline">
          <input type="radio" checked={mode === "rag"} onChange={() => setMode("rag")} /> Single-shot RAG
        </label>
      </div>
      <form onSubmit={onSubmit} className="actions">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about this resume…" aria-label="Question" />
        <button type="submit" disabled={active.isPending}>{active.isPending ? (mode === "agent" ? "Agent working…" : "Thinking…") : "Ask"}</button>
      </form>
      <div className="actions">
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="link" onClick={() => { setDraft(q); submit(q); }}>{q}</button>
        ))}
      </div>

      {active.isError && <p className="field-error">{active.error.message}</p>}
      {/* key: a new answer resets the highlighted citation. */}
      {mode === "rag" && ask.data && <RagAnswer key={ask.submittedAt} data={ask.data} />}
      {mode === "agent" && agent.data && <AgentAnswer key={agent.submittedAt} data={agent.data} />}
    </div>
  );
});
