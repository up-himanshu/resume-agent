import OpenAI from "openai";
import { startActiveObservation } from "@langfuse/tracing";
import { env } from "../env.js";

// One shared client. The SDK retries 429/5xx with exponential backoff (maxRetries) on its own;
// our code only handles failures the SDK can't: invalid or unusable model output.
export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  maxRetries: 2,
  timeout: 60_000,
});

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * Every chat call goes through here so each one becomes a Langfuse "generation": the exact
 * messages sent, the output, model, parameters, token usage (which Langfuse turns into cost)
 * and latency. When a call misbehaves, the trace shows precisely what the model saw.
 */
export function tracedChatCompletion(name: string, params: ChatParams, metadata: Record<string, unknown> = {}) {
  return startActiveObservation(
    name,
    async (generation) => {
      generation.update({
        model: params.model,
        input: params.messages,
        modelParameters: {
          reasoning_effort: params.reasoning_effort ?? "default",
          max_completion_tokens: params.max_completion_tokens ?? "default",
          ...(params.tool_choice ? { tool_choice: String(params.tool_choice) } : {}),
        },
        metadata: {
          ...metadata,
          tools: params.tools?.map((t) => (t.type === "function" ? t.function.name : t.type)),
          responseFormat: params.response_format?.type === "json_schema" ? params.response_format.json_schema.name : params.response_format?.type,
        },
      });
      try {
        const completion = await openai.chat.completions.create(params);
        const choice = completion.choices[0];
        const usage = completion.usage;
        const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
        generation.update({
          model: completion.model,
          output: choice?.message.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : choice?.message.content,
          // Cached input tokens are billed at a discount, so they're reported separately for accurate cost.
          usageDetails: {
            input: (usage?.prompt_tokens ?? 0) - cached,
            input_cached_tokens: cached,
            output: usage?.completion_tokens ?? 0,
          },
          metadata: { finishReason: choice?.finish_reason, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0 },
          level: choice?.finish_reason === "length" || choice?.message.refusal ? "WARNING" : "DEFAULT",
          statusMessage: choice?.message.refusal ?? undefined,
        });
        return completion;
      } catch (err) {
        generation.update({ level: "ERROR", statusMessage: (err as Error).message });
        throw err;
      }
    },
    { asType: "generation" },
  );
}
