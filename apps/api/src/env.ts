import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load the repo-root .env (Node's built-in loader; no dotenv needed). Missing file is fine:
// in CI or Docker the variables come from the real environment instead.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // no .env file
}

// Validate config once at startup and fail fast, instead of discovering a missing key
// on the first user request.
const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().startsWith("sk-", "OPENAI_API_KEY should start with sk-"),
  OPENAI_CHAT_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().min(1),
  DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  // Tracing is optional: without these keys the app runs exactly the same, just untraced.
  LANGFUSE_PUBLIC_KEY: z.string().startsWith("pk-lf-").optional(),
  LANGFUSE_SECRET_KEY: z.string().startsWith("sk-lf-").optional(),
  LANGFUSE_BASE_URL: z.url().default("https://cloud.langfuse.com"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
