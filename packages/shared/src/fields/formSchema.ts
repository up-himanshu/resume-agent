import { z } from "zod";
import type { FieldDefinition, FormDefinition, LeafField } from "./types.js";
import { PartialDateSchema, allFields, assertValidForm, isEmptyValue } from "./common.js";

// Builds the Zod schema the form validates against (React Hook Form + zodResolver in Step 3).
// Form values are UI-shaped: empty text is "", an empty number is null, unchecked is false.

function leafFormSchema(field: LeafField): z.ZodType {
  const requiredMsg = `${field.label} is required`;
  switch (field.type) {
    case "text":
    case "textarea":
    case "tel": {
      let s = z.string().trim();
      if (field.maxLength) s = s.max(field.maxLength, `${field.label} must be at most ${field.maxLength} characters`);
      return field.required ? s.min(1, requiredMsg) : s;
    }
    case "email":
    case "url": {
      const format = field.type === "email" ? z.email(`Enter a valid email`) : z.url(`Enter a valid URL`);
      return field.required ? format : z.union([z.literal(""), format]);
    }
    case "number": {
      let n = z.number({ error: `${field.label} must be a number` });
      if (field.integer) n = n.int(`${field.label} must be a whole number`);
      if (field.min !== undefined) n = n.min(field.min, `${field.label} must be at least ${field.min}`);
      if (field.max !== undefined) n = n.max(field.max, `${field.label} must be at most ${field.max}`);
      return field.required ? n : n.nullable();
    }
    case "select": {
      const options = z.enum(field.options.map((o) => o.value) as [string, ...string[]], { error: requiredMsg });
      return field.required ? options : z.union([z.literal(""), options]);
    }
    case "checkbox":
      return z.boolean();
    case "month":
      return field.required ? PartialDateSchema : z.union([z.literal(""), PartialDateSchema]);
    case "tags": {
      let a = z.array(z.string().trim().min(1));
      if (field.maxItems) a = a.max(field.maxItems, `At most ${field.maxItems} items`);
      return field.required ? a.min(1, requiredMsg) : a;
    }
  }
}

// Turns declarative `disabledWhen` rules into a Zod refinement: cross-field rules stay in config.
function objectWithRules(fields: FieldDefinition[], shape: Record<string, z.ZodType>) {
  return z.object(shape).superRefine((values: Record<string, unknown>, ctx) => {
    for (const f of fields) {
      if (f.disabledWhen && values[f.disabledWhen.field] === f.disabledWhen.equals && !isEmptyValue(values[f.name])) {
        ctx.addIssue({ code: "custom", path: [f.name], message: `${f.label} must be empty in this case` });
      }
    }
  });
}

export function fieldFormSchema(field: FieldDefinition): z.ZodType {
  if (field.type !== "group") return leafFormSchema(field);
  const item = objectWithRules(field.fields, Object.fromEntries(field.fields.map((f) => [f.name, leafFormSchema(f)])));
  let a = z.array(item);
  if (field.maxItems) a = a.max(field.maxItems, `At most ${field.maxItems} items`);
  return field.required ? a.min(1, `Add at least one ${field.itemLabel.toLowerCase()}`) : a;
}

export function buildFormSchema(form: FormDefinition) {
  assertValidForm(form);
  const fields = allFields(form);
  return objectWithRules(fields, Object.fromEntries(fields.map((f) => [f.name, fieldFormSchema(f)])));
}

export type FormValues = Record<string, unknown>;

export function emptyValue(field: FieldDefinition): unknown {
  switch (field.type) {
    case "number":
      return null;
    case "checkbox":
      return false;
    case "tags":
    case "group":
      return [];
    default:
      return "";
  }
}

export function buildDefaultValues(form: FormDefinition): FormValues {
  return Object.fromEntries(allFields(form).map((f) => [f.name, emptyValue(f)]));
}
