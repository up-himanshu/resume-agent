import { useState, type ReactNode } from "react";
import type { AnswerStatus, Citation, Claim } from "@resume-agent/shared";

/** What a citation can point at: a retrieved entry (RAG) or a tool call's output (agent). */
export interface AnswerSourceView {
  id: string;
  title: ReactNode;
  text: string;
  isError?: boolean;
}

const STATUS_BADGE: Record<AnswerStatus, { label: string; tone: string }> = {
  answered: { label: "Answered", tone: "good" },
  partial: { label: "Partly answered", tone: "" },
  not_in_resume: { label: "Not in resume", tone: "bad" },
};

/** Source text with the cited quote highlighted, using the span the server verified. */
function SourceText({ source, highlight }: { source: AnswerSourceView; highlight: Citation | null }) {
  const span = highlight?.sourceId === source.id ? highlight.span : null;
  if (!span) return <pre className="chunk-text">{source.text}</pre>;
  return (
    <pre className="chunk-text">
      {source.text.slice(0, span.start)}
      <mark>{source.text.slice(span.start, span.end)}</mark>
      {source.text.slice(span.end)}
    </pre>
  );
}

/** Claims with clickable citations, shared by single-shot RAG and the agent. */
export function AnswerView(props: {
  question: string;
  status: AnswerStatus;
  claims: Claim[];
  missing: string | null;
  unsupportedClaims: number;
  sources: AnswerSourceView[];
  sourcesLabel: string;
  stats: ReactNode;
  children?: ReactNode;
}) {
  const [highlight, setHighlight] = useState<Citation | null>(null);
  const badge = STATUS_BADGE[props.status];
  return (
    <div className="card answer">
      <div className="card-header">
        <strong>{props.question}</strong>
        <span className="scores">
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
          {props.unsupportedClaims > 0 && <span className="badge bad">{props.unsupportedClaims} unsupported</span>}
        </span>
      </div>
      {props.claims.map((claim, i) => (
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
              {cit.sourceId || "?"}
            </button>
          ))}
          {!claim.supported && <span className="muted"> (quote not found in the cited source)</span>}
        </p>
      ))}
      {props.missing && <p className="muted">Not covered: {props.missing}</p>}
      <p className="muted">{props.stats}</p>
      {props.children}
      <details open={highlight !== null}>
        <summary className="muted">{props.sourcesLabel} ({props.sources.length}). Click a citation to highlight its quote.</summary>
        {props.sources.map((s) => (
          <div key={s.id} className={`chunk-parent ${highlight?.sourceId === s.id ? "active" : ""}`}>
            <div className="chunk-meta">
              {s.title} {s.isError && <span className="badge bad">tool error</span>}
            </div>
            <SourceText source={s} highlight={highlight} />
          </div>
        ))}
      </details>
    </div>
  );
}
