import { memo, useCallback, useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import type { ExtractResponse, Suggestion } from "@resume-agent/shared";
import { form, type ProfileValues } from "../form/schema.js";
import { SuggestionCard, TagSuggestions, type ReviewStatus, type Span } from "./SuggestionCard.js";

interface Props {
  result: ExtractResponse;
  onShowEvidence: (span: Span) => void;
}

// Suggestions are review state, kept apart from form state: nothing touches the form until the
// user accepts. The parent remounts this panel (via `key`) for each new extraction, which resets it.
export const SuggestionsPanel = memo(function SuggestionsPanel({ result, onShowEvidence }: Props) {
  const { setValue, getValues } = useFormContext<ProfileValues>();
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>({});

  // useCallback keeps these identities stable so memoized cards skip re-rendering.
  const onAccept = useCallback(
    (s: Suggestion, value: unknown) => {
      const opts = { shouldValidate: true, shouldDirty: true, shouldTouch: true };
      if (s.kind === "field") {
        setValue(s.fieldName, value, opts);
      } else {
        const current = (getValues(s.fieldName) as unknown[] | undefined) ?? [];
        const duplicate =
          s.kind === "tagItem" &&
          current.some((t) => String(t).toLowerCase() === String(value).toLowerCase());
        if (!duplicate) setValue(s.fieldName, [...current, value], opts);
      }
      setStatuses((prev) => ({ ...prev, [s.id]: "accepted" }));
    },
    [setValue, getValues],
  );

  const onReject = useCallback((id: string) => setStatuses((prev) => ({ ...prev, [id]: "rejected" })), []);

  // Derived data: recompute only when the extraction result changes, not on every status change.
  const bySection = useMemo(
    () =>
      form.sections
        .map((section) => ({ section, items: result.suggestions.filter((s) => s.sectionId === section.id) }))
        .filter((g) => g.items.length > 0),
    [result],
  );

  const unverified = result.suggestions.filter((s) => s.grounding === "not_found" || s.grounding === "missing").length;
  const reviewed = Object.keys(statuses).length;

  return (
    <div className="suggestions">
      <div className="panel-summary">
        <span>{result.suggestions.length} suggestions · {reviewed} reviewed</span>
        {unverified > 0 && <span className="badge bad">{unverified} unverified</span>}
        <span className="muted">
          {(result.meta.latencyMs / 1000).toFixed(1)}s · {result.meta.usage.inputTokens + result.meta.usage.outputTokens} tokens · {result.meta.strategy}
        </span>
      </div>
      {result.meta.calls.filter((c) => c.error).map((c) => (
        <p key={c.group} className="field-error">Section “{c.group}” failed: {c.error}</p>
      ))}

      {bySection.map(({ section, items }) => {
        const tagItems = items.filter((s) => s.kind === "tagItem");
        const others = items.filter((s) => s.kind !== "tagItem");
        return (
          <section key={section.id}>
            <h3>{section.title}</h3>
            {tagItems.length > 0 && (
              <TagSuggestions items={tagItems} statuses={statuses} onAccept={onAccept} onReject={onReject} onShowEvidence={onShowEvidence} />
            )}
            {others.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                status={statuses[s.id] ?? "pending"}
                onAccept={onAccept}
                onReject={onReject}
                onShowEvidence={onShowEvidence}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
});
