// Demo of the validation-repair loop against the live model.
// We seed an invalid draft (current role WITH an endDate, which JSON Schema can't forbid),
// validate it with Zod, then send the model its errors and check the corrected output.
// Run: pnpm --filter @resume-agent/api exec tsx scripts/demo-repair.ts
import { z } from "zod";
import { ExtractedProfileSchema } from "@resume-agent/shared";
import { openai } from "../src/llm/openai.js";
import { toStrictJsonSchema } from "../src/llm/strictJsonSchema.js";
import { env } from "../src/env.js";

const resume = `SAM OKAFOR\nStaff Engineer\nsam@example.com\n\nNimbus Pay - Staff Engineer, Jan 2020 - Present\n- Owns the payments ledger\n\nSKILLS: Node.js, Kafka`;
const badDraft = {
  fullName: "Sam Okafor", email: "sam@example.com", phone: null, headline: "Staff Engineer",
  currentJobTitle: "Staff Engineer", skills: ["Node.js", "Kafka"],
  workExperience: [{ company: "Nimbus Pay", title: "Staff Engineer", location: null,
    startDate: "2020-01", endDate: "2024-12", isCurrent: true, highlights: ["Owns the payments ledger"] }],
};

const first = ExtractedProfileSchema.safeParse(badDraft);
if (first.success) throw new Error("expected the seeded draft to be invalid");
console.log("Validation errors on draft:\n" + z.prettifyError(first.error) + "\n");

const completion = await openai.chat.completions.create({
  model: env.OPENAI_CHAT_MODEL,
  reasoning_effort: "low",
  response_format: { type: "json_schema", json_schema: { name: "resume_profile", strict: true, schema: toStrictJsonSchema(ExtractedProfileSchema) } },
  messages: [
    { role: "system", content: "You extract structured profile data from a resume. Use only explicit information." },
    { role: "user", content: `<resume>\n${resume}\n</resume>` },
    { role: "assistant", content: JSON.stringify(badDraft) },
    { role: "user", content: `Your output failed validation:\n${z.prettifyError(first.error)}\nReturn the complete corrected JSON.` },
  ],
});

const repaired = ExtractedProfileSchema.safeParse(JSON.parse(completion.choices[0]?.message.content ?? "{}"));
console.log("Repaired output valid:", repaired.success);
if (repaired.success) console.log("Repaired role:", repaired.data.workExperience[0]);
