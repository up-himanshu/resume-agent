import { memo, useState, type FormEvent } from "react";
import type { AnswerSource, AnswerStatus, Citation } from "@resume-agent/shared";
import { useAsk } from "../api/hooks.js";

const EXAMPLES = ["Where has this person led a team?", "How long was the longest job?", "Do they know Kubernetes?"];

const STATUS_BADGE: Record<AnswerStatus, { label: string; tone: string }> = {
  answered: { label: "Answered", tone: "good" },
  partial: { label: "Partly answered", tone: "" },
  not_in_resume: { label: "Not in resume", tone: "bad" },
};

/** Shows the source entry with the cited quote highlighted, using the span the server verified. */
function SourceText({ source, highlight }: { source: AnswerSource; highlight: Citation | null }) {
  const span = highlight?.sourceId === source.sourceId ? highlight.span : null;
  if (!span) return <pre className="chunk-text">{source.text}</pre>;
  return (
    <pre className="chunk-text">
      {source.text.slice(0, span.start)}
      <mark>{source.text.slice(span.start, span.end)}</mark>
      {source.text.slice(span.end)}
    </pre>
  );
}

/** RAG Q&A: a cited answer per claim, each citation checked against its source on the server. */
export const AskPanel = memo(function AskPanel({ resumeId }: { resumeId: string }) {
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState<Citation | null>(null);
  const ask = useAsk(resumeId);

  const submit = (question: string) => {
    if (question.trim().length < 2) return;
    setHighlight(null);
    ask.mutate(question.trim());
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  const data = ask.data;
  return (
    <div className="search-panel">
      <form onSubmit={onSubmit} className="actions">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about this resume…" aria-label="Question" />
        <button type="submit" disabled={ask.isPending}>{ask.isPending ? "Thinking…" : "Ask"}</button>
      </form>
      <div className="actions">
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="link" onClick={() => { setDraft(q); submit(q); }}>{q}</button>
        ))}
      </div>

      {ask.isError && <p className="field-error">{ask.error.message}</p>}
      {data && (
        <div className="card answer">
          <div className="card-header">
            <strong>{data.question}</strong>
            <span className="scores">
              <span className={`badge ${STATUS_BADGE[data.status].tone}`}>{STATUS_BADGE[data.status].label}</span>
              {data.meta.unsupportedClaims > 0 && <span className="badge bad">{data.meta.unsupportedClaims} unsupported</span>}
            </span>
          </div>
          {data.claims.map((claim, i) => (
            <p key={i} className={`claim ${claim.supported ? "" : "unsupported"}`}>
              {claim.text}{" "}
              {claim.citations.map((cit, j) => (
                <button
                  key={j}
                  type="button"
                  className={`cite ${cit.grounding === "not_found" ? "bad" : ""}`}
                  title={`"${cit.quote}" (${cit.grounding})`}
                  onClick={() => setHighlight(cit)}
                >
                  {cit.sourceId}
                </button>
              ))}
              {!claim.supported && <span className="muted"> (quote not found in the cited source)</span>}
            </p>
          ))}
          {data.missing && <p className="muted">Not covered: {data.missing}</p>}
          <p className="muted">
            {data.meta.model ?? "no model call"} · {data.meta.attempts} attempt(s) · retrieval {data.meta.timingsMs.retrieval}ms · generation{" "}
            {data.meta.timingsMs.generation}ms · {data.meta.usage.inputTokens} in / {data.meta.usage.outputTokens} out tokens
          </p>
          <details open={highlight !== null}>
            <summary className="muted">Sources the model saw ({data.sources.length}). Click a citation to highlight its quote.</summary>
            {data.sources.map((s) => (
              <div key={s.sourceId} className={`chunk-parent ${highlight?.sourceId === s.sourceId ? "active" : ""}`}>
                <div className="chunk-meta">
                  <strong>[{s.sourceId}] {s.section}</strong> · {s.matchedChunkIds.length} matched chunk(s) · best rerank{" "}
                  {s.rerankScore?.toFixed(2) ?? "–"}
                </div>
                <SourceText source={s} highlight={highlight} />
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  );
});
