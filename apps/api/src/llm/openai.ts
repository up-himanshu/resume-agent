import OpenAI from "openai";
import { env } from "../env.js";

// One shared client. The SDK retries 429/5xx with exponential backoff (maxRetries) on its own;
// our code only handles failures the SDK can't: invalid or unusable model output.
export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  maxRetries: 2,
  timeout: 60_000,
});
