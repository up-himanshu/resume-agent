import { z } from "zod";

type JsonSchema = Record<string, unknown>;

// OpenAI strict structured outputs accept a subset of JSON Schema: every object must set
// additionalProperties: false and list *all* of its properties as required (use nullable for
// "may be absent"). Zod's generator does neither by default, so we enforce it here.
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  return makeStrict(json, "$");
}

function makeStrict(node: JsonSchema, path: string): JsonSchema {
  const out: JsonSchema = { ...node };

  if (out.type === "object" && out.properties) {
    const props = out.properties as Record<string, JsonSchema>;
    const required = new Set((out.required as string[] | undefined) ?? []);
    const missing = Object.keys(props).filter((k) => !required.has(k));
    if (missing.length) {
      throw new Error(`${path}: optional keys [${missing}] are not allowed in strict mode; use .nullable()`);
    }
    out.additionalProperties = false;
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, makeStrict(v, `${path}.${k}`)]),
    );
  }
  if (out.items) out.items = makeStrict(out.items as JsonSchema, `${path}[]`);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as JsonSchema[]).map((s, i) => makeStrict(s, `${path}|${i}`));
    }
  }
  return out;
}
