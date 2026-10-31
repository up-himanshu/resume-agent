import type { LeafField } from "@resume-agent/shared";

// Value-vs-evidence check. Grounding proves the evidence quote exists in the resume; this proves
// the *value* agrees with that quote. Without it, "0404-01" with evidence "Apr 2023 – Present"
// passed every check (schema, Zod, grounding, form rules). Dates are checked because they're the
// field type where the model normalizes most and we've seen it go wrong.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(month: number): string {
  return String(month).padStart(2, "0");
}

/** Every year and year-month mentioned in a piece of text, e.g. "Apr 2023", "04/2023", "2023-04". */
export function datesInText(text: string): { years: Set<string>; months: Set<string> } {
  const t = text.toLowerCase();
  const years = new Set<string>();
  const months = new Set<string>();

  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/g)) {
    months.add(`${m[2]}-${pad(MONTHS.indexOf(m[1]!) + 1)}`);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{4})\b/g)) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) months.add(`${m[2]}-${pad(month)}`);
  }
  for (const m of t.matchAll(/\b(\d{4})[/.-](\d{1,2})\b/g)) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) months.add(`${m[1]}-${pad(month)}`);
  }
  for (const m of t.matchAll(/\b(19|20)\d{2}\b/g)) years.add(m[0]);
  return { years, months };
}

/** Explains why a "YYYY-MM"/"YYYY" value contradicts its evidence, or returns null if it doesn't. */
export function dateMismatch(value: string, evidence: string | null): string | null {
  if (!evidence) return null;
  const { years, months } = datesInText(evidence);
  if (years.size === 0) return null; // the evidence has no dates, so there's nothing to compare
  const [year, month] = value.split("-");
  if (!years.has(year!)) {
    return `"${value}" doesn't match the evidence, which mentions ${[...years].join(", ")}`;
  }
  if (month && months.size > 0 && !months.has(value)) {
    return `"${value}" doesn't match the evidence, which mentions ${[...months].join(", ")}`;
  }
  return null;
}

/** Consistency problems for the month fields of one value (a top-level field or one group item). */
export function consistencyIssues(fields: LeafField[], values: Record<string, unknown>, evidence: string | null): string[] {
  return fields.flatMap((f) => {
    const value = values[f.name];
    if (f.type !== "month" || typeof value !== "string" || !value) return [];
    const problem = dateMismatch(value, evidence);
    return problem ? [`${f.label}: ${problem}`] : [];
  });
}
