import type OpenAI from "openai";
import { z } from "zod";
import type { LlmUsage } from "@resume-agent/shared";
import { startActiveObservation } from "@langfuse/tracing";
import { tracedChatCompletion } from "./openai.js";
import { toStrictJsonSchema } from "./strictJsonSchema.js";
import { env } from "../env.js";
import { HttpError, issuesOf } from "../http/errors.js";
import { log, logBlock } from "../log.js";

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
export function generateStructured<S extends z.ZodType>(opts: StructuredOptions<S>): Promise<StructuredResult<z.output<S>>> {
  // One span per structured call; each attempt is a child generation, so a repair shows up as
  // two generations under it (the second with the validation errors in its input).
  return startActiveObservation(
    `structured-output:${opts.name}`,
    async (span) => {
      span.update({ input: { name: opts.name } });
      try {
        const result = await runStructured(opts);
        span.update({
          output: result.data,
          metadata: { attempts: result.attempts, usage: result.usage },
          // A repair means the first answer was invalid: worth noticing even though we recovered.
          level: result.attempts > 1 ? "WARNING" : "DEFAULT",
          statusMessage: result.attempts > 1 ? `Needed ${result.attempts} attempts (repair retry)` : undefined,
        });
        return result;
      } catch (err) {
        span.update({ level: "ERROR", statusMessage: (err as Error).message });
        throw err;
      }
    },
    { asType: "chain" },
  );
}

interface StructuredOptions<S extends z.ZodType> {
  name: string;
  schema: S;
  system: string;
  user: string;
  /** Log scope, e.g. "llm/personal", so parallel calls can be told apart in the logs. */
  logScope?: string;
}

async function runStructured<S extends z.ZodType>(opts: StructuredOptions<S>): Promise<StructuredResult<z.output<S>>> {
  const scope = opts.logScope ?? `llm/${opts.name}`;
  const startedAt = performance.now();
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const jsonSchema = toStrictJsonSchema(opts.schema);
  log(scope, `Converted the Zod schema into a strict JSON Schema (${JSON.stringify(jsonSchema).length} chars). The model is forced to return exactly this shape (constrained decoding). Every "description" in it is read by the model as an instruction.`);
  logBlock(scope, `JSON Schema "${opts.name}" sent as response_format`, JSON.stringify(jsonSchema, null, 2));
  logBlock(scope, "User message (data + task)", opts.user);
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  let lastProblem: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log(scope, `Attempt ${attempt}/${MAX_ATTEMPTS}: calling OpenAI model "${env.OPENAI_CHAT_MODEL}" with ${messages.length} messages (roles: ${messages.map((m) => m.role).join(", ")}), reasoning_effort=low, max_completion_tokens=16000. Waiting for the reply...`);
    const callStartedAt = performance.now();
    const completion = await tracedChatCompletion(
      `${opts.name} (attempt ${attempt})`,
      {
        model: env.OPENAI_CHAT_MODEL,
        // A copy: later repair messages must not change what this attempt's trace shows as input.
        messages: [...messages],
        response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: jsonSchema } },
        // gpt-5 family are reasoning models: no temperature knob; effort controls hidden "thinking".
        reasoning_effort: "low",
        // Caps visible output *plus* reasoning tokens.
        max_completion_tokens: 16_000,
      },
      { attempt },
    );

    usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
    usage.outputTokens += completion.usage?.completion_tokens ?? 0;
    usage.reasoningTokens += completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    const choice = completion.choices[0];
    const callUsage = completion.usage;
    log(scope, `Attempt ${attempt}: model "${completion.model}" replied in ${Math.round(performance.now() - callStartedAt)}ms. finish_reason="${choice?.finish_reason}" ("stop" means it finished normally). Tokens: ${callUsage?.prompt_tokens ?? 0} input (${callUsage?.prompt_tokens_details?.cached_tokens ?? 0} of them served from OpenAI's prompt cache), ${callUsage?.completion_tokens ?? 0} output, of which ${callUsage?.completion_tokens_details?.reasoning_tokens ?? 0} were hidden reasoning tokens we pay for but never see.`);
    if (!choice) throw new HttpError(502, "LLM_EMPTY", "Model returned no choices");
    if (choice.message.refusal) {
      log(scope, `Attempt ${attempt}: the model REFUSED. Retrying won't change that, so we stop here.`, choice.message.refusal);
      throw new HttpError(422, "LLM_REFUSED", "Model refused the request", choice.message.refusal);
    }
    // Truncated JSON is unrecoverable by a "please fix it" retry with the same budget.
    if (choice.finish_reason === "length") {
      log(scope, `Attempt ${attempt}: the reply was cut off at the token limit, so the JSON is incomplete. A repair retry with the same budget would be cut off too, so we stop here.`);
      throw new HttpError(502, "LLM_TRUNCATED", "Model output hit the token limit");
    }

    const raw = choice.message.content ?? "";
    let pretty = raw;
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // leave as-is; the parse below reports it
    }
    logBlock(scope, `Raw model output, attempt ${attempt}`, pretty);

    let feedback: string;
    try {
      const parsed = JSON.parse(raw);
      log(scope, `Attempt ${attempt}: output is valid JSON. Now checking it with Zod, which also enforces rules JSON Schema can't express (e.g. "a current role has no end date", 0 <= confidence <= 1).`);
      const result = opts.schema.safeParse(parsed);
      if (result.success) {
        const latencyMs = Math.round(performance.now() - startedAt);
        log(scope, `Attempt ${attempt}: Zod validation PASSED. This call is done after ${attempt} attempt(s) and ${latencyMs}ms. Running token total for this call: ${JSON.stringify(usage)}.`);
        return { data: result.data, model: completion.model, attempts: attempt, latencyMs, usage };
      }
      lastProblem = issuesOf(result.error);
      feedback = z.prettifyError(result.error);
      log(scope, `Attempt ${attempt}: Zod validation FAILED with these problems:`, feedback);
    } catch {
      lastProblem = "Output was not valid JSON";
      feedback = "Your output was not valid JSON.";
      log(scope, `Attempt ${attempt}: output is NOT valid JSON.`);
    }

    if (attempt < MAX_ATTEMPTS) {
      log(scope, `Repair: adding the model's own bad output (as an "assistant" message) plus the exact errors (as a "user" message) to the conversation and asking it to fix them.`);
    } else {
      log(scope, `No attempts left (max ${MAX_ATTEMPTS}). Giving up on this call.`);
    }
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your output failed validation:\n${feedback}\nReturn the complete corrected JSON.` },
    );
  }

  throw new HttpError(502, "LLM_INVALID_OUTPUT", "Model output failed validation after retries", lastProblem);
}
