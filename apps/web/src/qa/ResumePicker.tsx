import { memo } from "react";
import { useResumes } from "../api/hooks.js";

/** Picks which saved resume search and Q&A run against. */
export const ResumePicker = memo(function ResumePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { data, isPending, isError, error } = useResumes();
  if (isPending) return <p className="muted">Loading saved resumes…</p>;
  if (isError) return <p className="field-error">{error.message}</p>;
  if (data.resumes.length === 0) return <p className="muted">No saved resumes yet. Process one to index it.</p>;

  const known = data.resumes.some((r) => r.resumeId === value);
  return (
    <div className="picker">
      <select value={known ? (value ?? "") : ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Saved resume">
        <option value="">Choose a saved resume…</option>
        {data.resumes.map((r) => (
          <option key={r.resumeId} value={r.resumeId}>
            {r.label} · {new Date(r.createdAt).toLocaleDateString()} · {r.childChunks} chunks
            {r.profileCount ? ` · ${r.profileCount} profile${r.profileCount > 1 ? "s" : ""}` : ""}
          </option>
        ))}
      </select>
      {value && !known && <p className="field-error">Resume {value} from the URL isn't in the database.</p>}
    </div>
  );
});
