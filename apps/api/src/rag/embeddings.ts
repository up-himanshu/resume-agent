import { openai } from "../llm/openai.js";
import { env } from "../env.js";
import { log } from "../log.js";

// Must match the vector(1536) column. Vectors from different models (or sizes) live in different
// spaces and can't be compared, which is why resumes are keyed by embedding model too.
export const EMBEDDING_DIMENSIONS = 1536;

// The API accepts many inputs per request; batching cuts round trips and rate-limit pressure.
const BATCH_SIZE = 100;

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  tokens: number;
  latencyMs: number;
}

export async function embedTexts(texts: string[], scope = "embed"): Promise<EmbeddingResult> {
  const startedAt = performance.now();
  const vectors: number[][] = [];
  let tokens = 0;
  let model = env.OPENAI_EMBEDDING_MODEL;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    log(scope, `Calling OpenAI embeddings ("${env.OPENAI_EMBEDDING_MODEL}") for ${batch.length} text(s) in one batched request (texts ${i + 1}-${i + batch.length} of ${texts.length}).`);
    const res = await openai.embeddings.create({ model: env.OPENAI_EMBEDDING_MODEL, input: batch });
    // Results carry an index; sort so vector i always belongs to text i.
    for (const item of [...res.data].sort((a, b) => a.index - b.index)) vectors.push(item.embedding);
    tokens += res.usage.prompt_tokens;
    model = res.model;
  }

  const dims = vectors[0]?.length ?? 0;
  if (vectors.length && dims !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding model returned ${dims} dimensions; the database column expects ${EMBEDDING_DIMENSIONS}`);
  }
  const latencyMs = Math.round(performance.now() - startedAt);
  const first = vectors[0];
  const norm = first ? Math.sqrt(first.reduce((s, x) => s + x * x, 0)) : 0;
  log(
    scope,
    `Got ${vectors.length} vector(s) of ${dims} numbers each in ${latencyMs}ms, costing ${tokens} tokens. ` +
      `First vector starts [${first?.slice(0, 5).map((x) => x.toFixed(4)).join(", ")}, ...] and has length ${norm.toFixed(3)} ` +
      `(OpenAI vectors are normalized to length 1, so cosine similarity = dot product).`,
  );
  return { vectors, model, tokens, latencyMs };
}

/** pgvector's text input format: "[0.1,0.2,...]". */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
