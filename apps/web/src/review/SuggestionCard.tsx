import { memo, useState } from "react";
import { useWatch } from "react-hook-form";
import { isEmptyValue, type Grounding, type Suggestion } from "@resume-agent/shared";
import { fieldsByName, type ProfileValues } from "../form/schema.js";

export type ReviewStatus = "pending" | "accepted" | "rejected";
export type Span = { start: number; end: number };

const GROUNDING_LABEL: Record<Grounding, string> = {
  exact: "Verified",
  normalized: "Verified (normalized)",
  not_found: "Unverified",
  missing: "No evidence",
};

export function GroundingBadge({ s }: { s: Suggestion }) {
  const tone = s.grounding === "exact" || s.grounding === "normalized" ? "good" : "bad";
  return (
    <span className={`badge ${tone}`} title={`Model said ${s.modelConfidence}; adjusted for grounding`}>
      {GROUNDING_LABEL[s.grounding]} · {Math.round(s.confidence * 100)}%
    </span>
  );
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object" && !Array.isArray(value)) {
    // Generic preview for group items: first few non-empty sub-values.
    return Object.values(value as Record<string, unknown>)
      .filter((v) => !isEmptyValue(v) && typeof v !== "boolean")
      .slice(0, 4)
      .map(String)
      .join(" · ");
  }
  return String(value);
}

interface Props {
  suggestion: Suggestion;
  status: ReviewStatus;
  onAccept: (s: Suggestion, value: unknown) => void;
  onReject: (id: string) => void;
  onShowEvidence: (span: Span) => void;
}

// memo + stable callbacks from the parent (useCallback) mean accepting one card re-renders only that card.
export const SuggestionCard = memo(function SuggestionCard({ suggestion: s, status, onAccept, onReject, onShowEvidence }: Props) {
  const field = fieldsByName.get(s.fieldName)!;
  const editable = s.kind === "field" && (typeof s.value === "string" || typeof s.value === "number");
  const [draft, setDraft] = useState(String(s.value ?? ""));
  // Subscribes to just this one form value, to show what accepting would replace.
  const current = useWatch<ProfileValues>({ name: s.fieldName });
  const replaces = s.kind === "field" && !isEmptyValue(current) && current !== s.value;

  const accept = () => {
    const value = editable ? (field.type === "number" ? (draft === "" ? null : Number(draft)) : draft) : s.value;
    onAccept(s, value);
  };

  return (
    <div className={`card status-${status}`}>
      <div className="card-header">
        <strong>{s.kind === "groupItem" ? `${field.label} ${Number(s.id.match(/\[(\d+)\]/)?.[1] ?? 0) + 1}` : field.label}</strong>
        <GroundingBadge s={s} />
      </div>

      {editable && status === "pending" ? (
        field.type === "textarea" ? (
          <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit ${field.label}`} />
        ) : (
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit ${field.label}`} />
        )
      ) : (
        <p className="value">{formatValue(s.value)}</p>
      )}

      {replaces && status === "pending" && <p className="hint">Replaces current: {formatValue(current)}</p>}
      {s.issues.length > 0 && (
        <ul className="issues">
          {s.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {s.evidence && (
        <blockquote className="evidence">
          “{s.evidence}”
          {s.evidenceSpan && (
            <button type="button" className="link" onClick={() => onShowEvidence(s.evidenceSpan!)}>
              Show in resume
            </button>
          )}
        </blockquote>
      )}

      {status === "pending" ? (
        <div className="actions">
          <button type="button" onClick={accept}>{s.kind === "field" ? "Accept" : "Add"}</button>
          <button type="button" className="secondary" onClick={() => onReject(s.id)}>Reject</button>
        </div>
      ) : (
        <p className="status-text">{status === "accepted" ? "✓ Applied to form" : "Rejected"}</p>
      )}
    </div>
  );
});

/** Tag suggestions (e.g. skills) are small, so they render as chips instead of full cards. */
export const TagSuggestions = memo(function TagSuggestions({
  items,
  statuses,
  onAccept,
  onReject,
  onShowEvidence,
}: {
  items: Suggestion[];
  statuses: Record<string, ReviewStatus>;
} & Omit<Props, "suggestion" | "status">) {
  const field = fieldsByName.get(items[0]!.fieldName)!;
  const pending = items.filter((s) => (statuses[s.id] ?? "pending") === "pending");
  return (
    <div className="card">
      <div className="card-header">
        <strong>{field.label}</strong>
        {pending.length > 0 && (
          <button type="button" className="link" onClick={() => pending.forEach((s) => onAccept(s, s.value))}>
            Add all {pending.length}
          </button>
        )}
      </div>
      <div className="chips">
        {items.map((s) => {
          const status = statuses[s.id] ?? "pending";
          return (
            <span key={s.id} className={`chip status-${status} ${s.grounding === "not_found" || s.grounding === "missing" ? "chip-bad" : ""}`}
              title={`${GROUNDING_LABEL[s.grounding]} · ${Math.round(s.confidence * 100)}% — “${s.evidence ?? ""}”`}>
              {s.evidenceSpan ? (
                <button type="button" className="chip-label" onClick={() => onShowEvidence(s.evidenceSpan!)}>{String(s.value)}</button>
              ) : (
                <span className="chip-label">{String(s.value)}</span>
              )}
              {status === "pending" ? (
                <>
                  <button type="button" aria-label={`Add ${s.value}`} onClick={() => onAccept(s, s.value)}>✓</button>
                  <button type="button" aria-label={`Reject ${s.value}`} onClick={() => onReject(s.id)}>×</button>
                </>
              ) : (
                <span className="chip-status">{status === "accepted" ? "✓" : "–"}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
});
