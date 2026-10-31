import { z } from "zod";
import type { FieldDefinition, LeafField } from "./types.js";
import { PartialDateSchema, isExtractable } from "./common.js";

// Builds the schema the *model* must fill. Every value is wrapped in a "suggestion unit":
// the value, the exact resume text supporting it, and the model's self-reported confidence.
// `.describe()` text becomes JSON Schema `description`, which the model reads like a prompt.

const EVIDENCE_DESCRIPTION =
  "Exact, verbatim quote from the resume that supports the value (a short span, copied character for character). null if the value is null.";

function unit(value: z.ZodType, description: string) {
  return z
    .object({
      value,
      evidence: z.string().nullable().describe(EVIDENCE_DESCRIPTION),
      confidence: z.number().min(0).max(1).describe("Your confidence in the value, 0 to 1."),
    })
    .describe(description);
}

function leafValueSchema(field: LeafField): z.ZodType {
  switch (field.type) {
    case "number":
      return field.integer ? z.int().nullable() : z.number().nullable();
    case "select":
      return z.enum(field.options.map((o) => o.value) as [string, ...string[]]).nullable();
    case "checkbox":
      return z.boolean().nullable();
    case "month":
      return PartialDateSchema.nullable();
    case "tags":
      return z.array(z.string());
    default:
      return z.string().nullable();
  }
}

function describeField(field: FieldDefinition): string {
  return [field.label, field.hint].filter(Boolean).join(". ");
}

export function fieldExtractionSchema(field: FieldDefinition): z.ZodType {
  switch (field.type) {
    case "tags":
      // One unit per tag, so every skill carries its own evidence.
      return z.array(unit(z.string(), "One item")).describe(describeField(field));
    case "group": {
      const item = z.object(
        Object.fromEntries(field.fields.map((f) => [f.name, leafValueSchema(f).describe(describeField(f))])),
      );
      return z.array(unit(item, `One ${field.itemLabel.toLowerCase()}`)).describe(describeField(field));
    }
    default:
      return unit(leafValueSchema(field), describeField(field));
  }
}

/** Schema for one extraction call covering the given fields (non-extractable ones are skipped). */
export function buildExtractionSchema(fields: FieldDefinition[]) {
  return z.object(Object.fromEntries(fields.filter(isExtractable).map((f) => [f.name, fieldExtractionSchema(f)])));
}
