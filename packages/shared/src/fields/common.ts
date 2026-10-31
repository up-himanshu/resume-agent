import { z } from "zod";
import type { FieldDefinition, FormDefinition } from "./types.js";

/** "YYYY-MM" or "YYYY". */
export const PartialDateSchema = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Use YYYY-MM or YYYY");

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}

export function allFields(form: FormDefinition): FieldDefinition[] {
  return form.sections.flatMap((s) => s.fields);
}

export function isExtractable(field: FieldDefinition): boolean {
  return field.extractable !== false;
}

/** Form values are a flat object keyed by field name, so names must be unique across sections. */
export function assertValidForm(form: FormDefinition): void {
  const seen = new Set<string>();
  for (const field of allFields(form)) {
    if (seen.has(field.name)) throw new Error(`Duplicate field name "${field.name}" in form "${form.id}"`);
    seen.add(field.name);
  }
}
