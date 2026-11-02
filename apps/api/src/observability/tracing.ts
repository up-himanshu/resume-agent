import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { getActiveTraceId, propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import type { TraceRef } from "@resume-agent/shared";
import { env } from "../env.js";
import { currentRequestId, log } from "../log.js";

// Observability, the three signals:
//   logs    - what happened, line by line (our plain-English logs; best for one request on one box)
//   metrics - aggregates over many requests: latency p95, tokens, cost, error rate (Langfuse dashboards)
//   traces  - one request as a tree of timed steps (spans): HTTP -> retrieval -> LLM call -> tool call
//
// Langfuse is built on OpenTelemetry: our code creates OTel spans (via @langfuse/tracing), and the
// LangfuseSpanProcessor batches them and exports them over OTLP/HTTP. Because it's OTel, the same
// spans could go to Jaeger, Datadog or Honeycomb by adding another processor.

export const tracingEnabled = Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);

const processor = tracingEnabled
  ? new LangfuseSpanProcessor({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
      environment: "development",
      // Spans are buffered and sent in batches in the background, never on the request path.
      flushInterval: 2,
    })
  : null;

if (processor) {
  // register() makes this the global provider and installs the AsyncLocalStorage context manager,
  // which is how a child span finds its parent across awaits and parallel Promise.all branches.
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
}

/** API client for things that aren't spans: scores and trace URLs. */
const langfuse = tracingEnabled
  ? new LangfuseClient({ publicKey: env.LANGFUSE_PUBLIC_KEY, secretKey: env.LANGFUSE_SECRET_KEY, baseUrl: env.LANGFUSE_BASE_URL })
  : null;

export function describeTracing(): string {
  return tracingEnabled
    ? `Tracing ON: spans are exported to Langfuse at ${env.LANGFUSE_BASE_URL}.`
    : "Tracing OFF: set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in .env to send traces to Langfuse.";
}

/**
 * Root of a trace: one per user-facing operation. Trace-level attributes (name, session, tags) are
 * propagated to every span created inside, so Langfuse can group and filter them.
 * sessionId = resume id: all questions about one resume show up as one session.
 */
export function withTrace<T>(
  name: string,
  attrs: { sessionId?: string; tags?: string[]; input?: unknown },
  fn: () => Promise<T>,
): Promise<T> {
  const requestId = currentRequestId();
  return propagateAttributes(
    {
      traceName: name,
      sessionId: attrs.sessionId,
      tags: attrs.tags,
      // The request id ties a Langfuse trace to the matching lines in the terminal logs.
      metadata: requestId ? { requestId } : undefined,
    },
    () =>
      startActiveObservation(name, async (span) => {
        span.update({ input: attrs.input });
        const traceId = activeTraceId();
        if (traceId) log("trace", `Langfuse trace ${traceId} started for "${name}".`);
        try {
          const result = await fn();
          span.update({ output: result });
          return result;
        } catch (err) {
          span.update({ level: "ERROR", statusMessage: (err as Error).message });
          throw err;
        }
      }),
  );
}

/** Trace id of the span we're inside, or null when tracing is off. */
export function activeTraceId(): string | null {
  if (!tracingEnabled) return null;
  return getActiveTraceId() ?? null;
}

/** Id + link for the UI, so you can jump from an answer to its trace. */
export async function traceRef(): Promise<TraceRef | null> {
  const id = activeTraceId();
  if (!id || !langfuse) return null;
  try {
    return { id, url: await langfuse.getTraceUrl(id) };
  } catch {
    return { id, url: null };
  }
}

/**
 * Scores are numbers or labels attached to a trace: the bridge from observability to evaluation.
 * Here they're computed automatically (citation checks); later from user feedback and LLM judges.
 */
export function score(
  traceId: string | null,
  name: string,
  value: number | string,
  opts: { dataType?: "NUMERIC" | "CATEGORICAL" | "BOOLEAN"; comment?: string } = {},
): void {
  if (!langfuse || !traceId) return;
  langfuse.score.create({ traceId, name, value, dataType: opts.dataType, comment: opts.comment });
  log("trace", `Score "${name}" = ${value} recorded on trace ${traceId}.`);
}

/** Send whatever is still buffered. Spans are batched, so exiting without this loses the last ones. */
export async function shutdownTracing(): Promise<void> {
  await Promise.allSettled([processor?.shutdown(), langfuse?.shutdown()]);
}

type StepType = "span" | "chain" | "retriever" | "tool" | "agent" | "guardrail" | "evaluator";

/**
 * A timed child step in the current trace. The observation type is only a label for the UI
 * (retriever, tool, guardrail, ...), but it makes a trace readable at a glance.
 */
export function traceStep<T>(
  name: string,
  opts: { asType?: StepType; input?: unknown; output?: (result: T) => unknown; metadata?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  return startActiveObservation(
    name,
    async (obs) => {
      obs.update({ input: opts.input, metadata: opts.metadata });
      try {
        const result = await fn();
        obs.update({ output: opts.output ? opts.output(result) : result });
        return result;
      } catch (err) {
        obs.update({ level: "ERROR", statusMessage: (err as Error).message });
        throw err;
      }
    },
    // The overloads differ only in the observation class handed to the callback; we use the shared update().
    { asType: (opts.asType ?? "span") as "span" },
  );
}
