import type OpenAI from "openai";
import { z } from "zod";
import type { LlmUsage } from "@resume-agent/shared";
import { openai } from "./openai.js";
import { toStrictJsonSchema } from "./strictJsonSchema.js";
import { env } from "../env.js";
import { HttpError, issuesOf } from "../http/errors.js";

// 1 normal attempt + 1 repair attempt. More rarely helps and multiplies cost and latency.
const MAX_ATTEMPTS = 2;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface StructuredResult<T> {
  data: T;
  model: string;
  attempts: number;
  latencyMs: number;
  usage: LlmUsage;
}

/**
 * One structured-output call: strict JSON Schema (constrained decoding) + Zod validation,
 * with a repair retry that shows the model its own output and the exact validation errors.
 */
export async function generateStructured<S extends z.ZodType>(opts: {
  name: string;
  schema: S;
  system: string;
  user: string;
}): Promise<StructuredResult<z.output<S>>> {
  const startedAt = performance.now();
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const jsonSchema = toStrictJsonSchema(opts.schema);
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  let lastProblem: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const completion = await openai.chat.completions.create({
      model: env.OPENAI_CHAT_MODEL,
      messages,
      response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: jsonSchema } },
      // gpt-5 family are reasoning models: no temperature knob; effort controls hidden "thinking".
      reasoning_effort: "low",
      // Caps visible output *plus* reasoning tokens.
      max_completion_tokens: 16_000,
    });

    usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
    usage.outputTokens += completion.usage?.completion_tokens ?? 0;
    usage.reasoningTokens += completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    const choice = completion.choices[0];
    if (!choice) throw new HttpError(502, "LLM_EMPTY", "Model returned no choices");
    if (choice.message.refusal) {
      throw new HttpError(422, "LLM_REFUSED", "Model refused the request", choice.message.refusal);
    }
    // Truncated JSON is unrecoverable by a "please fix it" retry with the same budget.
    if (choice.finish_reason === "length") {
      throw new HttpError(502, "LLM_TRUNCATED", "Model output hit the token limit");
    }

    const raw = choice.message.content ?? "";
    let feedback: string;
    try {
      const result = opts.schema.safeParse(JSON.parse(raw));
      if (result.success) {
        const latencyMs = Math.round(performance.now() - startedAt);
        console.log(`[llm:${opts.name}] ok attempts=${attempt} latency=${latencyMs}ms tokens=${JSON.stringify(usage)}`);
        return { data: result.data, model: completion.model, attempts: attempt, latencyMs, usage };
      }
      lastProblem = issuesOf(result.error);
      feedback = z.prettifyError(result.error);
    } catch {
      lastProblem = "Output was not valid JSON";
      feedback = "Your output was not valid JSON.";
    }

    console.warn(`[llm:${opts.name}] attempt ${attempt} failed validation:`, lastProblem);
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your output failed validation:\n${feedback}\nReturn the complete corrected JSON.` },
    );
  }

  throw new HttpError(502, "LLM_INVALID_OUTPUT", "Model output failed validation after retries", lastProblem);
}
