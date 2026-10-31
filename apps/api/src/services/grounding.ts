import type { Grounding } from "@resume-agent/shared";

// Grounding check: does the model's "evidence" quote actually appear in the resume?
// A quote we can't find is the clearest hallucination signal we have, and it's deterministic.

const CHAR_MAP: Record<string, string> = {
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-",
  "‘": "'", "’": "'", "“": '"', "”": '"',
};

/** Lowercase, unify dashes/quotes, collapse whitespace; keep a map back to original offsets. */
function normalize(text: string): { normalized: string; offsets: number[] } {
  let normalized = "";
  const offsets: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = CHAR_MAP[text[i]!] ?? text[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      offsets.push(i);
      pendingSpace = false;
    }
    for (const c of ch.toLowerCase()) {
      normalized += c;
      offsets.push(i);
    }
  }
  return { normalized, offsets };
}

export interface QuoteLocation {
  grounding: Grounding;
  span: { start: number; end: number } | null;
}

export function locateQuote(source: string, quote: string | null): QuoteLocation {
  if (!quote || !quote.trim()) return { grounding: "missing", span: null };

  const exact = source.indexOf(quote);
  if (exact !== -1) return { grounding: "exact", span: { start: exact, end: exact + quote.length } };

  const src = normalize(source);
  const q = normalize(quote).normalized;
  const idx = src.normalized.indexOf(q);
  if (idx === -1) return { grounding: "not_found", span: null };
  return {
    grounding: "normalized",
    span: { start: src.offsets[idx]!, end: src.offsets[idx + q.length - 1]! + 1 },
  };
}

// Heuristic weights: the model's self-reported confidence is poorly calibrated, so we discount
// it by what we could verify. Tune these against eval results (Step 10), not intuition.
const GROUNDING_WEIGHT: Record<Grounding, number> = {
  exact: 1,
  normalized: 0.9,
  missing: 0.5,
  not_found: 0.2,
};

export function adjustedConfidence(modelConfidence: number, grounding: Grounding): number {
  return Math.round(modelConfidence * GROUNDING_WEIGHT[grounding] * 100) / 100;
}
