import { memo } from "react";
import { useChunks } from "../api/hooks.js";

/** Shows how the resume was chunked for retrieval: each parent entry with its embedded children. */
export const ChunkList = memo(function ChunkList({ resumeId }: { resumeId: string }) {
  const { data, isPending, isError, error } = useChunks(resumeId);
  if (isPending) return <p className="muted">Loading chunks…</p>;
  if (isError) return <p className="field-error">{error.message}</p>;

  const parents = data.chunks.filter((c) => c.kind === "parent");
  return (
    <div className="chunks">
      {parents.map((p) => (
        <div key={p.id} className="chunk-parent">
          <div className="chunk-meta">
            <strong>{p.section}</strong> · parent #{p.chunkIndex} · chars {p.charStart}–{p.charEnd} · not embedded
          </div>
          <pre className="chunk-text">{p.sourceText}</pre>
          {data.chunks
            .filter((c) => c.parentId === p.id)
            .map((c) => (
              <div key={c.id} className="chunk-child">
                <div className="chunk-meta">
                  child #{c.chunkIndex} · chars {c.charStart}–{c.charEnd} · {c.hasEmbedding ? "embedded" : "no vector"}
                </div>
                <div>{c.content}</div>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
});
