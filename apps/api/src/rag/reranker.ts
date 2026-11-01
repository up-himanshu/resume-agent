import { fileURLToPath } from "node:url";
import { AutoModelForSequenceClassification, AutoTokenizer, env as hf } from "@huggingface/transformers";
import { log } from "../log.js";

// A CROSS-ENCODER reranker, run locally (ONNX, CPU) via transformers.js.
//
// Bi-encoder (our embeddings): query and chunk are encoded SEPARATELY into vectors, then compared.
//   Fast and precomputable (chunks embedded once), but the model never sees query and chunk together.
// Cross-encoder (this): query and chunk are fed TOGETHER through one transformer, so attention can
//   compare every query word with every chunk word. Much more accurate, but must run per (query, chunk)
//   pair at query time, so it's only used on a short candidate list from the fast first stage.
//
// ms-marco-MiniLM-L-6-v2: a small (6-layer) cross-encoder trained on Bing search relevance (MS MARCO).

export const RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

hf.cacheDir = fileURLToPath(new URL("../../../../.cache/models", import.meta.url));

type Loaded = {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
};
let loading: Promise<Loaded> | null = null;

/** Loads once per process (downloads ~23 MB from Hugging Face on the very first run, then cached). */
export function loadReranker(): Promise<Loaded> {
  loading ??= (async () => {
    const startedAt = performance.now();
    log("rerank", `Loading cross-encoder "${RERANKER_MODEL}" (quantized int8). First run downloads it into .cache/models; later runs load from disk.`);
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(RERANKER_MODEL),
      AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, { dtype: "q8" }),
    ]);
    log("rerank", `Cross-encoder ready in ${Math.round(performance.now() - startedAt)}ms.`);
    return { tokenizer, model };
  })();
  loading.catch(() => (loading = null)); // allow a retry after a failed download
  return loading;
}

/**
 * Relevance of each document to the query, as the model's raw logit: higher = more relevant,
 * above 0 = "this passage answers the query". We keep logits rather than a sigmoid because on our
 * domain (terse resume bullets vs the web passages it was trained on) most scores are negative,
 * and a sigmoid squashes them all to ~0.000, hiding the ordering. Rank by it; don't treat it as a
 * probability.
 */
export async function rerankScores(query: string, documents: string[]): Promise<number[]> {
  if (!documents.length) return [];
  const { tokenizer, model } = await loadReranker();
  // Pairs: [query, doc1], [query, doc2], ... tokenized as "[CLS] query [SEP] doc [SEP]".
  const inputs = tokenizer(new Array(documents.length).fill(query), {
    text_pair: documents,
    padding: true,
    truncation: true,
  });
  const { logits } = await model(inputs);
  return (logits.tolist() as number[][]).map((row) => row[0]!);
}
