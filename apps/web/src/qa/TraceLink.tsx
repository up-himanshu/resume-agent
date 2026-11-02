import type { TraceRef } from "@resume-agent/shared";
import { useFeedback } from "../api/hooks.js";

/** Link to the Langfuse trace behind a result, plus thumbs up/down stored as a score on it. */
export function TraceLink({ trace, feedback = false }: { trace: TraceRef | null; feedback?: boolean }) {
  const send = useFeedback();
  if (!trace) return null;
  const sent = send.isSuccess ? send.variables?.helpful : undefined;
  return (
    <span className="trace-link">
      {trace.url ? (
        <a href={trace.url} target="_blank" rel="noreferrer">View trace ↗</a>
      ) : (
        <span className="muted">trace {trace.id.slice(0, 8)}</span>
      )}
      {feedback && (
        <>
          <button type="button" className={`cite ${sent === true ? "chosen" : ""}`} disabled={send.isPending || send.isSuccess}
            onClick={() => send.mutate({ traceId: trace.id, helpful: true })} aria-label="Helpful">👍</button>
          <button type="button" className={`cite ${sent === false ? "chosen" : ""}`} disabled={send.isPending || send.isSuccess}
            onClick={() => send.mutate({ traceId: trace.id, helpful: false })} aria-label="Not helpful">👎</button>
          {send.isSuccess && <span className="muted">Thanks, saved to the trace</span>}
          {send.isError && <span className="field-error">{send.error.message}</span>}
        </>
      )}
    </span>
  );
}
