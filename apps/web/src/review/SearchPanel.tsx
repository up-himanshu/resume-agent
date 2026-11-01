import { memo, useState, type FormEvent } from "react";
import type { SearchResponse } from "@resume-agent/shared";
import { useSearch } from "../api/hooks.js";

const EXAMPLES = ["Where have I led a team?", "Which testing tools do I know?", "Kubernetes experience"];

function StageList({ title, items }: { title: string; items: SearchResponse["debug"]["vector"] }) {
  return (
    <div className="stage">
      <strong>{title}</strong>
      {items.length === 0 ? (
        <p className="muted">No matches</p>
      ) : (
        <ol>
          {items.slice(0, 5).map((i) => (
            <li key={i.chunkId} title={i.preview}>
              <span className="muted">{i.score.toFixed(3)}</span> {i.preview}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Retrieval only (no LLM answer yet): shows what vector, keyword, fusion and reranking each return. */
export const SearchPanel = memo(function SearchPanel({ resumeId }: { resumeId: string }) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [rerank, setRerank] = useState(true);
  const search = useSearch(resumeId, submitted, rerank);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim().length >= 2) setSubmitted(draft.trim());
  };

  return (
    <div className="search-panel">
      <form onSubmit={onSubmit} className="actions">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search your resume…" aria-label="Search query" />
        <button type="submit" disabled={search.isFetching}>{search.isFetching ? "Searching…" : "Search"}</button>
      </form>
      <div className="actions">
        <label className="checkbox-label inline">
          <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} /> Rerank with cross-encoder
        </label>
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="link" onClick={() => { setDraft(q); setSubmitted(q); }}>{q}</button>
        ))}
      </div>

      {search.isError && <p className="field-error">{search.error.message}</p>}
      {search.data && (
        <>
          <p className="muted">
            Keyword lexemes: [{search.data.debug.keywordLexemes}] · embed {search.data.debug.timingsMs.embedQuery}ms · search{" "}
            {search.data.debug.timingsMs.search}ms{search.data.debug.timingsMs.rerank !== null && ` · rerank ${search.data.debug.timingsMs.rerank}ms`}
          </p>
          {search.data.results.map((hit, i) => (
            <div key={hit.chunkId} className="card">
              <div className="card-header">
                <strong>#{i + 1} · {hit.section}</strong>
                <span className="scores">
                  {hit.scores.rerank && (
                    <span className={`badge ${hit.scores.rerank.score > -5 ? "good" : "bad"}`} title="Cross-encoder logit: higher = more relevant">
                      rerank {hit.scores.rerank.score.toFixed(2)}
                    </span>
                  )}
                  <span className="badge">RRF #{hit.scores.rrf.rank}</span>
                  <span className="badge">vector {hit.scores.vector ? `#${hit.scores.vector.rank} (${hit.scores.vector.score.toFixed(2)})` : "–"}</span>
                  <span className="badge">keyword {hit.scores.keyword ? `#${hit.scores.keyword.rank}` : "–"}</span>
                </span>
              </div>
              <p className="value">{hit.sourceText}</p>
              {hit.parentText && hit.parentText !== hit.sourceText && (
                <details>
                  <summary className="muted">Parent context (what the model will see)</summary>
                  <pre className="chunk-text">{hit.parentText}</pre>
                </details>
              )}
            </div>
          ))}
          <details>
            <summary className="muted">Compare each stage</summary>
            <div className="stages">
              <StageList title="Vector (cosine similarity)" items={search.data.debug.vector} />
              <StageList title="Keyword (ts_rank_cd)" items={search.data.debug.keyword} />
              <StageList title="Fused (RRF score)" items={search.data.debug.fused} />
            </div>
          </details>
        </>
      )}
    </div>
  );
});
