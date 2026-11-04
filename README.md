# Resume-to-Profile AI Assistant

A working full-stack AI app, built in steps for hands-on learning. Nothing in it is mocked: every feature calls real models, a real database and a real observability backend.

You can:
1. **Paste a resume and click Process.** An LLM fills in a config-driven profile form. Each suggestion carries a verbatim evidence quote that the server checks, and you accept, edit or reject each one before saving.
2. **Ask questions about any saved resume.** You can use single-shot RAG (hybrid search, reranking, then one cited answer) or an agent that calls MCP tools in a bounded loop. Every claim's citation is verified against its source.
3. **See every request as a trace** in Langfuse, with token usage, cost, scores and 👍/👎 feedback.
4. **Run evals** (`pnpm eval`) on a golden set with code checks and a calibrated LLM judge, gated in CI.

> No LangChain or LangGraph. The RAG pipeline, agent loop, eval runner and structured-output repair loop are written by hand so every mechanism is visible.

---

## Contents
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [API endpoints](#api-endpoints)
- [Request flows](#request-flows)
- Steps
  - [Step 0: Scaffolding and contracts](#step-0-scaffolding-and-contracts)
  - [Step 1: Structured extraction with a live LLM](#step-1-structured-extraction-with-a-live-llm)
  - [Step 2: Config-driven fields and grounded suggestions](#step-2-config-driven-fields-and-grounded-suggestions)
  - [Step 3: React form and review UI](#step-3-react-form-and-review-ui)
  - [Step 3b: The date bug fix](#step-3b-the-date-bug-fix-a-real-incident)
  - [Step 4: Chunking, embeddings, pgvector and profile saving](#step-4-chunking-embeddings-pgvector-and-profile-saving)
  - [Step 5: Hybrid retrieval and reranking](#step-5-hybrid-retrieval-and-reranking)
  - [Step 6: RAG answers with verified citations](#step-6-rag-answers-with-verified-citations)
  - [Step 7: MCP server](#step-7-mcp-server)
  - [Step 8: Bounded agent loop (agentic RAG)](#step-8-bounded-agent-loop-agentic-rag)
  - [Step 9: Observability with OpenTelemetry and Langfuse](#step-9-observability-with-opentelemetry-and-langfuse)
  - [Step 10: Evals and a CI gate](#step-10-evals-and-a-ci-gate)
- [Concept reference](#concept-reference)

---

## Architecture

```
apps/web  (React 19 + Vite, React Hook Form + Zod, React Query, Axios)
   │  HTTP; every response is parsed with the shared Zod contracts
   ▼
apps/api  (Express 5 + TypeScript)
   ├─ /extract ─────────► extraction service ─► OpenAI gpt-5-mini (strict JSON schema, repair loop)
   ├─ /resumes ─────────► ingestion: chunk → embed (text-embedding-3-small) → Postgres
   ├─ /resumes/:id/search ► hybrid search: pgvector + full-text → RRF → cross-encoder rerank
   ├─ /resumes/:id/ask ──► RAG: search → sources c1..cN → one cited answer → verify quotes
   ├─ /resumes/:id/agent ► agent loop ─► MCP client ─(in-memory)─► MCP server tools
   ├─ /mcp ──────────────► the same MCP server over Streamable HTTP (also stdio: pnpm mcp)
   ├─ /profiles, /feedback, /health
   └─ OpenTelemetry spans ─► Langfuse (traces, cost, scores, datasets, experiments)
   ▼
PostgreSQL 17 + pgvector (Docker): resumes, resume_chunks (vector + tsvector), profiles

packages/shared  field config + Zod schemas = the API contract, used by both web and api
apps/api/evals   golden set, LLM judge, scoring and gates (pnpm eval, GitHub Actions)
```

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (pnpm 12.9.1, Node 24), TypeScript everywhere |
| Frontend | React 19, Vite, React Hook Form + `zodResolver`, TanStack React Query, Axios |
| Backend | Express 5, run with `tsx` |
| Contracts | Zod 4 in `packages/shared` (types inferred from the schemas) |
| Database | PostgreSQL 17 + pgvector (HNSW index), Postgres full-text search (GIN index) |
| LLM | OpenAI `gpt-5-mini` (extraction, answers, agent), `gpt-5` (eval judge) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dimensions) |
| Reranker | `Xenova/ms-marco-MiniLM-L-6-v2` cross-encoder, local CPU via Transformers.js / ONNX |
| Agent tools | Model Context Protocol (`@modelcontextprotocol/sdk`), stdio + Streamable HTTP + in-memory |
| Observability | OpenTelemetry + Langfuse (US cloud) |
| Evals / CI | Our own runner + Langfuse datasets and experiments, GitHub Actions |

## Getting started

Prerequisites: Node 24, pnpm 12, Docker, an OpenAI API key. A Langfuse account is optional.

```bash
pnpm install
```
```bash
cp .env.example .env
```
Edit `.env`: set `OPENAI_API_KEY`. To enable tracing, also set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL`. `OPENAI_JUDGE_MODEL` is optional and defaults to `gpt-5`.

```bash
pnpm db:up
```
```bash
pnpm db:migrate
```
```bash
pnpm dev
```
Open http://localhost:5173 (the API runs on http://localhost:4000).

| Script | What it does |
|---|---|
| `pnpm dev` | API and web app together (`dev:api`, `dev:web` run one) |
| `pnpm db:up` / `db:down` / `db:psql` | Start or stop Postgres, open a psql shell |
| `pnpm db:migrate` | Apply new SQL files from `db/migrations/` |
| `pnpm typecheck` | Type-check every package |
| `pnpm mcp` | Run the MCP server over stdio |
| `pnpm mcp:inspect` | Open the MCP Inspector against the stdio server |
| `pnpm eval` | Run the golden-set evals (`--mode rag\|agent\|both`, `--cases id1,id2`, `--no-langfuse`) |

To use the MCP server from Claude Code:
```bash
claude mcp add resume-agent -- npx tsx /absolute/path/to/resume-agent/apps/api/src/mcp/stdio.ts
```

## Project structure

```
.github/workflows/evals.yml      CI: eval gate on PRs
db/init/001-extensions.sql       enables pgvector on first DB start
db/migrations/                   001 resumes+chunks, 002 profiles, 003 keyword search
samples/resume-priya.txt         sample resume (also the eval fixture)
packages/shared/src/
  contracts/                     Zod request/response schemas for every endpoint
  fields/                        form field config + schema generators
apps/api/
  scripts/                       migrate.ts, demo-repair.ts
  src/
    server.ts, env.ts, db.ts, log.ts
    http/errors.ts               typed errors, parseOrThrow
    llm/                         OpenAI client, strict JSON schema, generateStructured
    services/                    extraction, grounding, consistency, ingestion, answering
    rag/                         chunker, embeddings, reranker, retrieval
    repositories/                SQL for resumes, chunks, profiles
    routes/                      extract, resumes, profiles, feedback
    mcp/                         MCP server + stdio and HTTP transports
    agent/                       agent loop + local months_between tool
    observability/tracing.ts     OpenTelemetry → Langfuse helpers
  evals/                         golden.ts, judge.ts, scoring.ts, run.ts
apps/web/src/
  api/                           Axios client + React Query hooks
  form/                          config-driven form renderer
  review/                        suggestion review, chunk list, search panel
  qa/                            resume picker, ask panel, answer view, trace link
```

## API endpoints

Every request and response body is a Zod schema in `packages/shared/src/contracts/`. The API validates requests and also checks its own responses against the schema before sending them. Errors share one shape, `{code, message, issues?}`.

| Endpoint | Request → Response | Purpose |
|---|---|---|
| `GET /health` | → `{status, db: {connected, pgvectorVersion}}` (200 or 503) | Liveness plus DB and pgvector check; the UI polls it |
| `POST /extract` | `{resumeText, strategy}` → `{suggestions[], calls[], usage, trace}` | LLM extraction of form suggestions with grounded evidence |
| `POST /profiles` | `{resumeId?, formId, formVersion, values}` → `201 {profileId, savedAt}` | Save the reviewed form (server re-validates; 409 if the form version changed) |
| `POST /resumes` | `{resumeText}` → `{resumeId, reused, chunkCounts, embedding}` | Ingest: hash, chunk, embed, store (idempotent) |
| `GET /resumes` | → `{resumes[]}` | Saved resumes for the picker |
| `GET /resumes/:id/chunks` | → `{resumeId, chunks[]}` | Inspect how a resume was chunked |
| `POST /resumes/:id/search` | `{query, k, rerank}` → `{results[], debug}` | Retrieval only, with each stage's scores |
| `POST /resumes/:id/ask` | `{question, k}` → `{status, claims[], missing, sources[], trace, meta}` | Single-shot RAG with verified citations |
| `POST /resumes/:id/agent` | `{question, maxTurns}` → `{status, claims[], toolCalls[], turns[], trace, meta}` | Agentic RAG over MCP tools |
| `POST /feedback` | `{traceId, helpful, comment?}` → 202/204 | 👍/👎 stored as a Langfuse score |
| `POST /mcp` | JSON-RPC 2.0 → JSON or SSE | MCP server over stateless Streamable HTTP (GET/DELETE return 405) |

## Request flows

**Process (paste a resume, click Process).** The web app fires two requests in parallel:
- `POST /extract`: fields are grouped by section, then one strict-schema LLM call per section runs in parallel (`Promise.allSettled`). Each result is validated by Zod and repaired once if needed. Each evidence quote is located in the resume, dates are checked against their evidence, and confidence is adjusted. The result is a flat list of suggestions.
- `POST /resumes`: the text is hashed and reused if already stored. Otherwise it's chunked into parents and children, the children are embedded, and everything is written in one transaction.

**Ask, RAG mode** (`POST /resumes/:id/ask`, trace `rag-answer`):
1. Zod validates the request.
2. Hybrid search: the query is embedded, then vector search (10 candidates) and keyword search (10) run in parallel and are fused with RRF.
3. The cross-encoder reranks the candidates and keeps the top k (6), with parent text attached.
4. Hits are grouped by parent entry into sources c1..cN.
5. One `gpt-5-mini` structured call returns a status and claims, with `sourceId` limited to an enum of the real ids. A repair retry runs if needed.
6. `locateQuote` checks each quote. The `answer_status` and `unsupported_claims` scores are recorded.

**Ask, agent mode** (`POST /resumes/:id/agent`, trace `agent-answer`):
1. An in-memory MCP client runs `tools/list`. `list_resumes` is hidden, `resumeId` is removed from the model's view and filled in by our code, and `months_between` is added.
2. Each turn, the model either requests tools (run in parallel) or answers. Tool output is capped at 8,000 characters, duplicate calls hit a cache, and errors go back to the model.
3. The loop is capped at `maxTurns` (default 6). On the last turn tools are switched off, so the model must answer.
4. Each quote is checked against the output of a tool the agent actually called. Scores are recorded.

**End.** `AnswerView` shows the claims with citation chips that highlight the exact span, a status badge, a "View trace ↗" link, and 👍/👎 feedback.

---

## Step 0: Scaffolding and contracts

**Built:** a pnpm monorepo; Postgres 17 with pgvector in Docker Compose; `.env` config validated at startup; a shared contracts package; an Express 5 `/health` endpoint that validates its own response.

**Files and main functions**

| File | What's in it |
|---|---|
| `docker-compose.yml` | `pgvector/pgvector:pg17` with a named volume and a health check |
| `db/init/001-extensions.sql` | `CREATE EXTENSION vector` on first start |
| `packages/shared/src/contracts/health.ts` | `HealthResponseSchema` |
| `apps/api/src/env.ts` | `env`: Zod-parsed config; exits with a clear list of bad values |
| `apps/api/src/db.ts` | `pool`: the `pg` connection pool |
| `apps/api/src/server.ts` | Express app, `GET /health`, startup and bind-error handling |
| `pnpm-workspace.yaml`, `tsconfig.base.json`, `package.json` | Workspace, shared TS config, root scripts |

**What we learned**
- **Schemas are the contract, and types come from schemas.** TypeScript types vanish at runtime; Zod schemas check real data. The same idea later protects us from model output, which is untrusted input.
- **Fail-fast config:** a bad key or URL stops the app at boot, not on the first user request.
- **pgvector keeps vectors next to relational data**, so one SQL query can combine similarity, keyword search and filters.
- **Supply-chain safety:** pnpm blocks dependency install scripts unless you allow them by name.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| pgvector in Postgres | Pinecone, Qdrant, Weaviate, Milvus | ✅ Scale to billions, managed, extra features. ❌ Another system to run and keep in sync; no joins or transactions with your data |
| Shared Zod package | OpenAPI + codegen, tRPC, GraphQL | ✅ OpenAPI works across languages; tRPC removes the HTTP layer. ❌ Codegen needs a build step; tRPC ties you to TypeScript; GraphQL adds a schema layer and tooling |
| Shared package exports TS source | Build it to `dist/` | ✅ Needed for publishing; faster CI typechecks. ❌ A build step for every change |
| Docker Compose | Local Postgres install, Supabase / Neon | ✅ Managed cloud is the path to production. ❌ Local installs differ per machine; cloud needs an account and network |
| Node's `loadEnvFile` | `dotenv` | ✅ Familiar, works on older Node. ❌ One more dependency |

> **Soundbite:** "API contracts are Zod schemas in a shared package, so frontend and backend validate the same shapes at runtime and the types are inferred. I apply the same rule to LLM output: it's untrusted until a schema says otherwise. Storage is Postgres with pgvector, so embeddings, keyword search and relational filters run in one query."

---

## Step 1: Structured extraction with a live LLM

**Built:** `POST /extract` sends the resume to `gpt-5-mini` with a strict JSON schema, validates the result with Zod (including cross-field rules), and runs one repair attempt with the exact validation errors. Refusals and truncation fail fast. Token usage is reported.

**Files and main functions**

| File | What's in it |
|---|---|
| `packages/shared/src/contracts/extract.ts` | `ExtractRequestSchema`, `ExtractResponseSchema`, `ApiErrorSchema`, `LlmUsageSchema` |
| `apps/api/src/llm/openai.ts` | `openai` client |
| `apps/api/src/llm/strictJsonSchema.ts` | `toStrictJsonSchema()`: Zod → JSON Schema in the form OpenAI strict mode accepts (all properties required, no extra properties) |
| `apps/api/src/services/extraction.ts` | Prompt building, model call, validation, repair (later generalized in Step 2) |
| `apps/api/src/http/errors.ts` | `HttpError`, `parseOrThrow()`, `issuesOf()`, `errorHandler`: 400 for bad requests, 502/422 for model failures |
| `apps/api/scripts/demo-repair.ts` | Demo that feeds an invalid draft and shows the repair loop fixing it |
| `samples/resume-priya.txt` | Sample resume, reused by the evals |

**What we learned**
- **Three levels of structured output:** asking for JSON in the prompt (weakest), JSON mode (valid JSON, any shape), and **strict JSON Schema** (constrained decoding; the model can't produce tokens that break the schema). We use strict mode.
- **Strict mode rules:** every property is required and `additionalProperties: false`; "not found" is `null`, not a missing key.
- **Schema shape isn't business logic.** "A current role has no end date" can't be written in JSON Schema, so Zod checks it after the call.
- **Repair loop:** send the model its output plus the exact Zod errors, capped at 2 attempts because every retry costs money and time.
- **Not every failure deserves a retry:** a refusal won't change, truncation won't fix itself with the same token budget, and the SDK already retries rate limits and 5xx errors.
- **Reasoning models:** gpt-5 has no `temperature`; `reasoning_effort` controls hidden thinking tokens, which you pay for.
- **Prompt injection:** the resume is wrapped in `<resume>` tags and labelled as untrusted data. A test with "Ignore all previous instructions" was ignored.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Our own Zod → strict schema converter | SDK's `zodResponseFormat` | ✅ Less code. ❌ Hides what strict mode requires |
| `response_format: json_schema` | Forced tool call (`tool_choice`) | ✅ Same guarantee and more portable across providers (Claude etc.). ❌ Slightly more plumbing to read the result |
| Chat Completions API | OpenAI Responses API | ✅ Server-side state, built-in tools. ❌ OpenAI-specific; Chat Completions is the format other providers copy |
| LLM extraction | Regex / NER parsers (spaCy, resume parsers) | ✅ Cheap, fast, deterministic. ❌ Break on unusual layouts and wording |
| `gpt-5-mini`, low effort | Larger or smaller models | ✅ Bigger is more accurate; smaller is cheaper. ❌ Choose by eval scores, not intuition (one line in `.env`) |

> **Soundbite:** "I use strict JSON-schema outputs so the model can't produce invalid shapes, then Zod validates business rules the schema can't express. On failure the model gets the exact errors for one repair attempt. Refusals and truncation fail fast because retrying won't help, and every response reports tokens and latency."

---

## Step 2: Config-driven fields and grounded suggestions

**Built:** one field config generates the form's Zod schema, the LLM's extraction schema and default values. Extraction runs one call per form section in parallel. Every suggestion carries a verbatim evidence quote that the server locates in the resume, plus an adjusted confidence and any validation issues.

**Files and main functions**

| File | What's in it |
|---|---|
| `packages/shared/src/fields/types.ts` | Field types as a union on `type` (text, email, month, select, tags, group…) with `required`, `extractable`, `hint`, `disabledWhen` |
| `packages/shared/src/fields/profileForm.ts` | The actual form: 5 sections, repeatable work-experience and education groups |
| `packages/shared/src/fields/formSchema.ts` | `buildFormSchema()` (config → React Hook Form schema, `disabledWhen` → `superRefine`), `buildDefaultValues()`, `emptyValue()` |
| `packages/shared/src/fields/extractionSchema.ts` | `buildExtractionSchema()`: config → model schema; each value wrapped as `{value, evidence, confidence}`; hints become JSON Schema descriptions |
| `packages/shared/src/fields/common.ts` | `PartialDateSchema`, `isEmptyValue()`, `allFields()`, `isExtractable()`, `assertValidForm()` |
| `apps/api/src/llm/structured.ts` | `generateStructured()`: generic "schema + prompt in, typed result out" with the repair loop |
| `apps/api/src/services/grounding.ts` | `locateQuote()` (exact, then normalized match, returning original character positions), `adjustedConfidence()` |
| `apps/api/src/services/extraction.ts` | `extractSuggestions()`: `extractionGroups()` → parallel calls with `Promise.allSettled` → `toSuggestions()` → `validationIssues()` |

**What we learned**
- **One config, many generated artifacts:** adding field 151 is one config entry, with no new component and no prompt edit.
- **Schema descriptions are prompts.** Field hints travel inside the JSON Schema, the same mechanism as MCP tool descriptions.
- **Grounding is a cheap, deterministic hallucination check:** the model must quote its source and we verify the quote exists. It's necessary but not sufficient; it doesn't prove the value is right.
- **Self-reported confidence is poorly calibrated** (almost everything came back 0.9–0.95), so we discount it by what we could verify.
- **Model output shape ≠ form value shape:** a conversion layer maps the model's `null` to `""`, `false` or `[]`.
- **Not everything should be AI-filled:** `workMode` is `extractable: false`.
- **Give the model facts it can't know**, such as today's date.
- **Partial failure:** `allSettled` means one failed section doesn't discard the other four.
- **Measured tradeoff:** per-section was ~43% faster than one big call, for ~2.2× the input tokens.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Model quotes evidence, we search for it | Model returns character offsets | ✅ No search needed. ❌ Models are bad at counting characters |
| Exact then normalized substring match | Fuzzy match, embedding similarity, NLI / LLM judge | ✅ NLI or a judge checks that evidence *supports* the value. ❌ Slower, costs money, not deterministic |
| Self-confidence × grounding weight | Token logprobs, self-consistency (sample N), calibration from evals | ✅ Self-consistency and calibration are more accurate. ❌ N× cost, or needs labelled data |
| One call per section, in parallel | One call total; one call per field; detect relevant sections first | ✅ One call is cheapest; two-stage skips empty sections. ❌ One call is slower; per-field is far too many calls |
| TypeScript config in the repo | JSON in a DB / CMS, JSON Forms, Form.io | ✅ Non-engineers can edit forms. ❌ Needs versioning and migrations |
| Declarative `disabledWhen` | Arbitrary functions, JSON Logic | ✅ Functions are flexible; JSON Logic is serializable and expressive. ❌ Functions can't be serialized or sent to clients |
| `Promise.allSettled` | `Promise.all` | ✅ Simpler all-or-nothing. ❌ One failure throws away everything |

> **Soundbite:** "One serializable field config generates the form schema, the LLM's output schema and the defaults, so going from 20 to 150 fields is config, not code. Every suggestion must include a verbatim evidence quote that the backend verifies; a quote we can't find is a near-certain hallucination. For large forms I extract per section in parallel: 43% faster for about twice the input tokens."

---

## Step 3: React form and review UI

**Built:** the form renders entirely from config, with React Hook Form and `zodResolver`, `useFieldArray` for repeatable groups, and a suggestions panel kept separate from form state. Users accept, edit or reject each suggestion. API calls go through a typed Axios client that parses every response with the shared contracts.

**Files and main functions**

| File | What's in it |
|---|---|
| `apps/web/vite.config.ts` | Proxies `/api/*` to the API (same-origin, no CORS in dev) |
| `apps/web/src/api/client.ts` | `api` object and `request()`: Axios call + Zod parse of the response, typed `ApiClientError` |
| `apps/web/src/api/hooks.ts` | `useHealth()` (polling query), `useExtract()` (mutation) |
| `apps/web/src/form/schema.ts` | `formSchema`, `defaultValues`, `fieldsByName`, built once at module load |
| `apps/web/src/form/fields.tsx` | `FieldRenderer` (memo, switches on type), `LeafInput` (uncontrolled `register`), `TagsInput` (`Controller`), `GroupFieldRenderer` (`useFieldArray`), `ConditionalLeaf` (`useWatch` for `disabledWhen`), `FieldError` (subscribes only to its own error) |
| `apps/web/src/form/ProfileForm.tsx` | `ProfileForm`: renders sections and fields |
| `apps/web/src/review/SuggestionsPanel.tsx` | `SuggestionsPanel`: review state, `onAccept` / `onReject` with `useCallback`, `setValue(..., {shouldValidate: true})` |
| `apps/web/src/review/SuggestionCard.tsx` | `SuggestionCard`, `TagSuggestions`, `GroundingBadge`, `formatValue()`: editable draft, evidence, "Show in resume" |
| `apps/web/src/App.tsx` | `App`: `useForm`, uncontrolled resume textarea, evidence highlighting, Process / Save |
| `apps/api/src/log.ts` | `log()`, `logBlock()`: plain-English step logs with request ids |

**What we learned**
- **Human in the loop:** suggestions are a review layer; the form only changes when the user accepts. In testing the model returned a start date of `2012-03` while its own verified evidence said "Mar 2022", so we never auto-apply.
- **Validate at every trust boundary:** the backend validates model output; the frontend validates API responses.
- **Performance for 150+ fields:**
  - uncontrolled inputs (`register`), so a keystroke doesn't re-render React;
  - `useFormState({name})` per field, so only that field re-renders on its error;
  - targeted `useWatch` only where a field depends on another;
  - `memo` + `useCallback` (stable function identities) + `useMemo` (cached values);
  - module-level constants for static config.
- **Server state vs client state:** React Query owns server state; RHF owns form state; review state is local.
- **Reset state with `key`** instead of syncing in `useEffect`.
- **Gotchas:** RHF's `disabled` makes submitted values `undefined` (we use read-only and clear the value instead); always use `useFieldArray`'s `id` as the key, never the index.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| React Hook Form (uncontrolled) | Formik, TanStack Form, controlled `useState` | ✅ TanStack Form is fully type-safe. ❌ Formik / controlled state re-render on every keystroke; TanStack has a smaller ecosystem |
| Own config renderer | JSON Forms, react-jsonschema-form, Form.io | ✅ Lots out of the box. ❌ Fights custom UX like a review panel |
| Render all fields | Virtualization (react-window), wizard steps | ✅ Smaller DOM, less cognitive load. ❌ More complexity; hidden fields need `shouldUnregister: false` |
| Validate on blur | On change, on submit | ✅ On-change gives instant feedback; on-submit is cheapest. ❌ On-change runs Zod on every keystroke; on-submit is the worst UX |
| Vite proxy | CORS, BFF / gateway | ✅ Needed in production anyway. ❌ More setup for local dev |
| Accept writes into the form | Staging object merged on save | ✅ Enables undo-all and diffs. ❌ More state to manage |
| Zod-parse API responses | Trust TS types, OpenAPI codegen | ✅ No runtime cost. ❌ Contract drift goes unnoticed (codegen only catches it if you regenerate) |

> **Soundbite:** "The form renders from config: one `FieldRenderer` switches on field type and repeatable groups use `useFieldArray`. For 150+ fields, inputs are uncontrolled, each field subscribes only to its own error, and only conditional fields use `useWatch`, so a keystroke re-renders one component. AI suggestions are a separate review layer, because in testing the model returned 2012 while its own verified evidence said 2022."

---

## Step 3b: The date bug fix (a real incident)

**Symptom:** dates like `0404-01` and `3201-03` for "Apr 2023". They passed every format check. Only 1 of 4 live runs had all dates correct.

**Root cause:** the month format existed only as a regex in the model's schema. Constrained decoding forced digits the model hadn't planned. A prompt refactor in Step 2 had removed the line that described the format in words.

**Fix:** describe the format in words, check it in code after generation, and add a value-vs-evidence check. Result: 4 of 4 runs correct, all on the first attempt.

| File | What changed |
|---|---|
| `packages/shared/src/fields/extractionSchema.ts` | Month values are plain `string \| null` with a `.refine()` (not emitted into JSON Schema); `FORMAT_HINTS` adds "Format YYYY-MM, e.g. Apr 2023 → 2023-04" to every month field's description |
| `packages/shared/src/fields/common.ts` | `PARTIAL_DATE_RE` shared by both schemas (the form schema still uses it as a regex for user input) |
| `apps/api/src/services/consistency.ts` *(new)* | `datesInText()`, `dateMismatch()`, `consistencyIssues()`: flags a value whose year or month isn't in its own evidence |
| `apps/api/src/services/extraction.ts` | Consistency issues added to each suggestion's `issues` |

**What we learned**
- **Constrained decoding guarantees shape, not meaning.**
- **Tell the model in words, verify in code.**
- **Check the value against its evidence**, not just that the evidence exists.
- **Prompt refactors silently regress behaviour**, which is why evals run on every change (Step 10).

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Regex removed from the model schema, Zod checks afterwards | Keep the regex and add the description | ✅ Fewer repair calls if it works. ❌ The regex can still distort generation |
| Rule-based date consistency check | LLM judge per field | ✅ Covers any field. ❌ Latency and cost on every suggestion |
| Mismatch shown as an issue | Lower confidence, or drop the suggestion | ✅ Cleaner UI. ❌ Hides the problem from the user |

> **Soundbite (STAR):** "Strict structured outputs produced dates like '0404-01' for 'Apr 2023'. The format was only a regex in the schema, so constrained decoding forced digits the model hadn't planned, and every format check passed because the output was well-formed. I described the format in words, moved the regex to post-generation validation with a repair retry, and added a value-vs-evidence check. Accuracy went from 1 in 4 to 4 in 4. The cause was a prompt refactor, which is why I run evals on every change."

---

## Step 4: Chunking, embeddings, pgvector and profile saving

**Built:** clicking Process now also indexes the resume: it's stored, chunked structurally into parents and children, and the children are embedded into pgvector with an HNSW index. Ingestion is idempotent by content hash. Save profile writes to Postgres after the server re-validates with the same schema the browser uses.

**Files and main functions**

| File | What's in it |
|---|---|
| `db/migrations/001_resumes_and_chunks.sql` | `resumes` (unique `content_hash` + `embedding_model`), `resume_chunks` (parent/child, `content`, `source_text`, char offsets, `embedding vector(1536)`), HNSW cosine index |
| `db/migrations/002_profiles.sql` | `profiles` with `data jsonb`, `form_id`, `form_version`, `resume_id` FK |
| `apps/api/scripts/migrate.ts` | Migration runner: `schema_migrations` table, one transaction per file |
| `apps/api/src/rag/chunker.ts` | `chunkResume()`: `isHeading()` → sections, `toEntries()` → entries, a parent per entry, a child per bullet with a context header, `windows()` (500 chars, 100 overlap) for entries without bullets |
| `apps/api/src/rag/embeddings.ts` | `embedTexts()` (batches of 100, order kept, dimension check), `toPgVector()` |
| `apps/api/src/repositories/resumes.ts` | `findResumeByHash()`, `insertResume()` (`ON CONFLICT DO NOTHING`), `insertChunks()` (one multi-row insert), `countChunks()`, `listChunks()` |
| `apps/api/src/services/ingestion.ts` | `ingestResume()`: hash → reuse check → chunk → embed (outside the transaction) → one transaction |
| `apps/api/src/repositories/profiles.ts` | `insertProfile()`, `resumeExists()` |
| `apps/api/src/routes/resumes.ts`, `routes/profiles.ts` | `POST /resumes`, `GET /resumes/:id/chunks`, `POST /profiles` (409 on stale form version) |
| `packages/shared/src/contracts/resumes.ts`, `profiles.ts` | Ingest, chunk and profile contracts |
| `apps/web/src/review/ChunkList.tsx` | Shows parents with their embedded children |

**What we learned**
- **Embeddings:** text → 1536 numbers where similar meaning means nearby vectors. OpenAI vectors have length 1, so cosine similarity equals the dot product.
- **Chunking, all in one chunker:** section-aware splits, **parent-child** (search small, read big), **contextual headers** (`Experience > Brightline Health — …:` so a bullet carries its job), overlapping windows for long text.
- **Embed the text you search on; cite the text you show:** `content` is embedded, `source_text` + offsets are used for citations.
- **The embedding model is part of your data:** vectors from different models can't be compared, so the model is in the uniqueness key.
- **Vector indexes:** HNSW (graph; fast, high recall, slower to build) vs IVFFlat (clusters; fast to build, needs tuning, lower recall).
- **Idempotent ingestion** (content hash, `ON CONFLICT DO NOTHING`).
- **Never hold a transaction open across a network call.**
- **Server-side re-validation and versioned forms; `jsonb` for config-driven data.**

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Structure-aware parent-child chunks | Fixed-size, recursive, semantic, LLM / proposition chunking | ✅ Fixed-size is simple; semantic adapts to topic; LLM chunking is highest quality. ❌ Fixed-size splits mid-thought; semantic needs embeddings up front and a threshold; LLM chunking is slow and costly |
| Only children embedded | Embed parents too; multi-vector; summary embeddings | ✅ Can improve recall. ❌ More storage and dedup at query time |
| `text-embedding-3-small` | `-3-large`, Voyage, Cohere, local bge / nomic | ✅ Larger is more accurate; local is free and private. ❌ Cost, or hosting it yourself |
| pgvector + HNSW | Dedicated vector DB; IVFFlat; no index | ✅ Scale; IVFFlat builds faster; exact search is perfectly accurate. ❌ Another system; IVFFlat needs tuning; exact is slow past ~100k rows |
| Own migration runner | node-pg-migrate, Prisma, Drizzle, Knex | ✅ Down-migrations, locking, type generation. ❌ More to learn and configure |
| `jsonb` profile | Column per field, EAV table | ✅ Columns are strongly typed. ❌ A migration per field; EAV is painful to query |
| Ingest on Process | Lazy (on first question), job queue | ✅ Saves cost; a queue handles big documents. ❌ First question is slower; a queue is more infrastructure |

> **Soundbite:** "I chunk structurally: each job is a parent, each bullet a child. Only children are embedded, each prefixed with its section and job so the vector carries context; search matches the child and the model reads the parent. Chunks keep their exact source span for citations. Ingestion is idempotent by content hash scoped to the embedding model, embeddings are computed outside the transaction, and everything is written in one multi-row insert."

---

## Step 5: Hybrid retrieval and reranking

**Built:** `hybridSearch()` runs pgvector cosine search and Postgres full-text search in parallel, fuses them with Reciprocal Rank Fusion, reranks with a local cross-encoder, and attaches parent text. `POST /resumes/:id/search` and a Search panel show every stage's scores.

**Files and main functions**

| File | What's in it |
|---|---|
| `db/migrations/003_chunk_keyword_search.sql` | Generated `search_tsv tsvector` column + GIN index |
| `apps/api/src/rag/reranker.ts` | `loadReranker()` (lazy, cached in `.cache/models`, warmed at startup), `rerankScores()` (raw logits per query + chunk pair) |
| `apps/api/src/rag/retrieval.ts` | `hybridSearch()` → `vectorSearch()` + `keywordSearch()` in parallel → RRF `Σ 1/(60 + rank)` → rerank → `parentTexts()`; returns debug lists and timings |
| `packages/shared/src/contracts/search.ts` | `SearchRequestSchema`, `SearchHitSchema` (vector / keyword / rrf / rerank scores), `SearchResponseSchema` |
| `apps/web/src/review/SearchPanel.tsx` | `SearchPanel`, `StageList`: results and a stage-by-stage comparison |
| `apps/web/src/api/hooks.ts` | `useSearch()`, a *query* (cached by resume, query, rerank) because search is a read |

**What we learned**
- **Hybrid search works because the retrievers fail differently.** Keyword search found "led a team" where vectors ranked a mentoring bullet first; vectors mapped "testing tools" to Jest and Playwright where keywords found nothing.
- **RRF** fuses by rank only, because cosine and `ts_rank` scores aren't comparable. Items found by both lists rise.
- **Postgres `ts_rank` is not BM25:** no IDF, so "experience" (in every header) matched everything. Real BM25: ParadeDB `pg_search`, Elasticsearch / OpenSearch.
- **Bi-encoder vs cross-encoder:** embeddings are precomputed and fast but never compare texts directly. A cross-encoder reads query and chunk together (more accurate, per pair), so retrieve broadly and rerank a short list (~40 ms for 10–15 pairs).
- **Domain shift:** the MS MARCO reranker gives negative logits even for correct resume matches. Rank by them; don't threshold without calibration.
- **Verify a model on a known example** before blaming your data.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| RRF | Weighted score sum `α·vec + (1−α)·kw` | ✅ Uses score magnitudes. ❌ Needs normalization and tuning α per dataset |
| Postgres full-text | ParadeDB BM25, Elasticsearch / OpenSearch, SPLADE | ✅ Real IDF; learned term expansion (SPLADE). ❌ Extension or separate system to sync; SPLADE needs inference |
| Local MiniLM cross-encoder | Cohere / Voyage / Jina rerank APIs, bge-reranker, LLM reranker, ColBERT | ✅ Stronger, multilingual; LLMs understand the domain; ColBERT is fast enough for retrieval. ❌ API keys, cost and latency; LLMs cost seconds per query |
| Rerank top ~20 | Rerank everything; skip reranking | ✅ Skipping is fastest. ❌ Cost grows with candidates; skipping loses precision |
| Child chunks with context headers | Raw text; weighted header vs body (`setweight`) | ✅ Weighting stops header words dominating. ❌ More tuning |
| (Not used) | Knowledge-graph RAG | ✅ Great for multi-hop questions. ❌ Entity extraction and a graph store; overkill for one resume |

> **Soundbite:** "Retrieval is hybrid: pgvector and Postgres full-text in parallel, fused with RRF because their scores aren't comparable, then reranked by a cross-encoder. Each retriever rescued queries the other missed. Embeddings are a fast precomputed bi-encoder; the cross-encoder reads query and passage together, so it only reranks a shortlist. And `ts_rank` isn't BM25, which I saw when 'experience' matched every chunk."

---

## Step 6: RAG answers with verified citations

**Built:** a saved-resume picker (id kept in `?resume=`) and `POST /resumes/:id/ask`. Retrieved chunks are grouped by parent into sources c1..cN, one structured LLM call returns a status and claims with verbatim quotes, and each quote is located in the source it cites.

**Files and main functions**

| File | What's in it |
|---|---|
| `packages/shared/src/contracts/answer.ts` | `AskRequestSchema`, `AnswerStatusSchema` (answered / partial / not_in_resume), `AnswerSourceSchema`, `CitationSchema`, `ClaimSchema`, `AskResponseSchema` |
| `apps/api/src/services/answering.ts` | `answerQuestion()`: `hybridSearch()` → `buildSources()` → `answerSchema()` (per-request schema; `sourceId` is a `z.enum` of real ids; `superRefine` rules like "not_in_resume ⇒ no claims") → `generateStructured()` → `locateQuote()` per citation |
| `apps/api/src/repositories/resumes.ts` | `listResumes()`: label, date, chunk and profile counts in one query |
| `apps/api/src/routes/resumes.ts` | `GET /resumes`, `POST /resumes/:id/ask` |
| `apps/web/src/qa/useActiveResume.ts` | `useActiveResume()`: URL is the source of truth (`pushState`, `popstate`) |
| `apps/web/src/qa/ResumePicker.tsx` | `ResumePicker` dropdown |
| `apps/web/src/qa/AskPanel.tsx` | `AskPanel`: question box, status, claims, sources |
| `apps/web/src/api/hooks.ts` | `useResumes()` (query), `useAsk()` (mutation, because generation costs tokens) |

**What we learned**
- **Retrieve small, read big, quote precise.**
- **Make bad citations impossible to write:** `sourceId` is an enum of retrieved ids, so constrained decoding can't produce `c9` when there are 4 sources.
- **Citations are claims too, so verify them:** the model can cite the right source and still invent the quote.
- **"Not in the resume" is a designed status**, not an error. We don't refuse on a rerank threshold, because a correct hit scored −9.5.
- **Claims make answers checkable**, one sentence with its own evidence (the same structure RAGAS faithfulness uses).
- **Query vs mutation:** retrieval is a cached query; generation is an explicit mutation.
- **Key limitation found:** top-k RAG can't answer aggregate questions ("longest job", "total experience", "all employers"), because it only compares what it retrieved. It answered "longest job" correctly by luck.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Structured claims with quotes | Free text with `[c1]` markers | ✅ Reads naturally, streams. ❌ Citations parsed by regex; no per-sentence checking |
| Verify quotes after generation | Trust the model's citations | ✅ No work. ❌ Hallucinated quotes go unnoticed |
| Quote check (exists) | NLI / LLM judge (supports) | ✅ Checks the quote actually supports the claim. ❌ Latency, cost, non-deterministic |
| Whole parent entries as context | Only matched chunks | ✅ Fewer tokens. ❌ Loses details like dates in the entry header |
| Model decides "not in resume" | Rerank-score threshold | ✅ Skips the LLM call. ❌ False "not found" on out-of-domain scores |
| Single-shot top-k | Agentic RAG; whole resume in context | ✅ Agent handles aggregate questions; full context is simple for one resume. ❌ Agent costs ~3× and ~2× latency; full context doesn't scale to many documents |
| Wait for the full answer | Stream tokens | ✅ Feels faster. ❌ Citations can't be verified until the JSON is complete |
| Picker state in the URL | React state, localStorage | ✅ Simpler. ❌ Lost on refresh, not shareable |

> **Soundbite:** "Answers are structured claims with citations. The citation id is an enum of the chunks I actually retrieved, so the model can't cite a source it didn't see, and every quote is located in its source before I show it. 'Not in the resume' is a first-class status. The limit I found is that top-k RAG can't answer 'longest job', because it only compares what it retrieved, which is why I built an agent next."

---

## Step 7: MCP server

**Built:** an MCP server named `resume-agent` with one definition and two transports: stdio (`pnpm mcp`) and stateless Streamable HTTP (`POST /mcp`). Tested with the official MCP Inspector.

| MCP part | Name | Purpose |
|---|---|---|
| Tool | `list_resumes` | Stored resumes with ids and names |
| Tool | `search_resume` | Hybrid search + rerank over one resume |
| Tool | `get_resume_section` | Every entry in a section (fixes "longest job") |
| Resource | `resume://{resumeId}` | Full resume text, attachable as context |
| Prompt | `screen_candidate` | Template to assess a resume against a role |

**Files and main functions**

| File | What's in it |
|---|---|
| `apps/api/src/mcp/server.ts` | `createMcpServer()`: tools with input/output schemas and annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint: false`), server `instructions`, resource, prompt; helpers `ok()` (text + `structuredContent`), `toolError()` (`isError` with a fix hint), `traced()` |
| `apps/api/src/mcp/stdio.ts` | stdio entry point: logs to stderr, `StdioServerTransport`, reranker warm-up |
| `apps/api/src/mcp/http.ts` | `mcpRouter`: stateless `POST /mcp` (new server + transport per request), 405 for GET/DELETE |
| `apps/api/src/log.ts` | `sendLogsToStderr()`, `withRequestContext()` |
| `apps/api/src/repositories/resumes.ts` | `getResumeContent()`, `listEntries()` |

**What we learned**
- **MCP** is a standard (JSON-RPC) for connecting tools and data to any AI app. Clients discover capabilities at runtime with `tools/list`.
- **Three primitives, by who decides:** tools (the model), resources (the app or user), prompts (the user).
- **Transports:** stdio (one process per client, no auth needed) vs Streamable HTTP (remote, needs auth such as OAuth 2.1). Stateless HTTP scales horizontally.
- **On stdio, stdout is the protocol:** one stray `console.log` corrupts a message.
- **Tool errors vs protocol errors:** `isError: true` is a result the model reads and recovers from; a good error says how to fix the call.
- **Tool design for an LLM caller:** compact outputs, descriptions that say *when* to use each tool (they're part of the prompt), narrow task-shaped tools.
- **Annotations are hints, not enforcement.**

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| MCP server | REST API, in-app function calling | ✅ Simpler when only one app uses the tools. ❌ Every host needs custom glue |
| stdio + HTTP | Only one transport | ✅ Less code. ❌ Lose either local hosts or remote use |
| Stateless HTTP | Stateful sessions | ✅ Can push notifications, keep per-client state. ❌ Sticky sessions or shared state behind a load balancer |
| Retrieval tools | One `ask_resume` tool returning a finished answer | ✅ Simple for weak hosts. ❌ Nests one LLM inside another; hides the steps |
| Narrow tools | Generic `run_sql` | ✅ Flexible. ❌ Error-prone, injection risk |
| Errors list valid sections | Enum of sections in the schema | ✅ Model sees options up front. ❌ Sections differ per resume, so a fixed enum would be wrong |
| No auth (local) | OAuth 2.1, API key | ✅ Required for real deployment. ❌ Setup not needed for local learning |

> **Soundbite:** "I wrapped retrieval in an MCP server so any host (Claude Desktop, Claude Code, or my own agent) can use it with no custom glue: one definition, stdio for local hosts with all logs on stderr, and stateless Streamable HTTP in Express. Tools are designed for an LLM caller: compact outputs, descriptions that say when to use them, read-only annotations, and `isError` results that tell the model how to recover."

---

## Step 8: Bounded agent loop (agentic RAG)

**Built:** `POST /resumes/:id/agent`. The model works in turns: it picks tools, our code runs them and returns the results, and it decides again until it can answer. Tools come from the Step 7 MCP server through a real MCP client, plus a local `months_between` calculator. The web app gets an Agent / RAG toggle and a turn-by-turn trace view.

**Files and main functions**

| File | What's in it |
|---|---|
| `apps/api/src/agent/agent.ts` | `runAgent()` → `connectMcp()` (`InMemoryTransport`, `tools/list`) → `toOpenAiTool()` (removes `resumeId`; `HIDDEN_TOOLS` hides `list_resumes`) → `runAgentLoop()` (tools + `response_format` each turn, parallel tool calls, last turn `tool_choice: "none"`, 8,000-char output cap, `callKey()` duplicate cache, errors fed back, repair turns) → citation check against tool outputs; `systemPrompt()`, `resultText()` |
| `apps/api/src/agent/localTools.ts` | `monthsBetween()`: strict schema, inclusive months, union of date ranges (no double counting), plain-text output that's easy to quote |
| `packages/shared/src/contracts/agent.ts` | `AgentRequestSchema` (`maxTurns` 2–10, default 6), `AgentToolCallSchema`, `AgentTurnSchema`, `AgentResponseSchema` |
| `apps/web/src/qa/AnswerView.tsx` | `AnswerView`, `SourceText`: shared claims view with source highlighting |
| `apps/web/src/qa/AskPanel.tsx` | Mode toggle, `RagAnswer`, `AgentAnswer` |
| `apps/web/src/api/hooks.ts` | `useAgent()` |

**What we learned**
- **The agent loop:** reason → call tool → read result → repeat. The state is the message history.
- **Agentic vs single-shot RAG:** the agent chooses *how* to retrieve (whole section for "longest", rephrased search when one misses, parallel lookups), at ~3× the cost and ~2× the latency.
- **Agents must be bounded:** turn limit, forced final turn, capped output, repeat detection, errors fed back.
- **Security belongs in code, not the prompt:** the model never sees `resumeId`, so prompt injection can't widen its scope (least privilege).
- **Give the model a calculator:** it got date arithmetic wrong (10y2m instead of ≥10y4m).
- **Tool output is part of the prompt:** plain sentences can be quoted exactly; the model paraphrased JSON keys, which broke verification.
- **MCP pays off:** swap the transport and the same agent talks to any MCP server.
- **Repair is just another turn:** a "not in resume" answer with claims was rejected by Zod and fixed on the next turn.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Hand-written loop | OpenAI Agents SDK, LangGraph, Vercel AI SDK | ✅ Tracing, handoffs, streaming, retries built in. ❌ Hides the mechanics; framework lock-in |
| One ReAct-style agent | Plan-then-execute, supervisor / router with sub-agents | ✅ Better for long, many-sided tasks. ❌ More tokens, harder to debug |
| In-process MCP | stdio subprocess, remote HTTP server | ✅ Failure isolation, third-party servers. ❌ Process spawn or network hop |
| `resumeId` injected by code | Model passes the id | ✅ Flexible (compare resumes). ❌ Trusts the model with access control |
| Non-strict tool schemas | Strict function calling | ✅ Guaranteed argument shape. ❌ MCP schemas have optional / defaulted args strict mode forbids |
| Return the whole run | Stream turns over SSE | ✅ 10–14 s feels responsive. ❌ More plumbing |
| Turn limit | Token / cost budget | ✅ Closer to what matters in production. ❌ Harder to reason about |
| Agent as default | Router: cheap RAG first, escalate to agent | ✅ Saves cost on simple questions. ❌ Router can misroute |

> **Soundbite:** "Single-shot RAG answered 'longest job' right by luck, so I built a bounded agent. The model chooses between MCP tools through a real MCP client; scope is enforced in code, since the resume id is injected server-side. The loop has a turn limit with a forced final answer, capped output, repeat detection and errors fed back. Testing showed bad date arithmetic, so I gave it a deterministic calculator, and every quote is verified against the output of a tool it actually called."

---

## Step 9: Observability with OpenTelemetry and Langfuse

**Built:** every user-facing operation is a Langfuse trace built from OpenTelemetry spans: `extract-profile`, `ingest-resume`, `search`, `rag-answer`, `agent-answer`, and `mcp:<tool>` for external MCP calls. Scores are attached to traces, the UI links to each trace, and 👍/👎 is saved as `user_feedback`. Without Langfuse keys, the app works the same, untraced.

**Files and main functions**

| File | What's in it |
|---|---|
| `apps/api/src/observability/tracing.ts` | `NodeTracerProvider` + `LangfuseSpanProcessor` (only with keys); `withTrace()` (root: name, session id = resume id, tags, request id), `traceStep()` (typed child span: retriever, tool, guardrail, agent, chain), `activeTraceId()`, `traceRef()`, `score()`, `shutdownTracing()`, `describeTracing()`, `langfuse` |
| `apps/api/src/llm/openai.ts` | `tracedChatCompletion()`: every chat call is a generation with input, output, model, usage (input / cached / output) and cost; WARNING on refusal or truncation |
| `apps/api/src/llm/structured.ts` | One `structured-output:<name>` span per call, one generation per attempt |
| `apps/api/src/rag/embeddings.ts`, `rag/retrieval.ts` | Embedding observations; retriever span with vector / keyword / rerank children |
| `apps/api/src/services/answering.ts`, `agent/agent.ts` | `verify-citations` guardrail span; scores `answer_status`, `unsupported_claims`, `agent_turns`, `agent_tool_errors` |
| `apps/api/src/services/extraction.ts` | Scores `evidence_not_found`, `grounded_ratio`, `suggestions_with_issues` |
| `apps/api/src/routes/feedback.ts` | `POST /feedback` → `user_feedback` BOOLEAN score |
| `packages/shared/src/contracts/trace.ts` | `TraceRefSchema`, `FeedbackRequestSchema` |
| `apps/web/src/qa/TraceLink.tsx` | `TraceLink`: "View trace ↗" + 👍/👎 |

**What we learned**
- **Logs, metrics, traces:** logs are events line by line; metrics are aggregates (p95 latency, cost/day); traces are one request as a tree of timed spans. For LLM apps, traces matter most because they show *what the model saw*.
- **OpenTelemetry vs Langfuse:** OTel creates and moves spans; Langfuse stores them with LLM-aware features (generations, cost, scores, sessions, datasets). Adding Jaeger or Datadog is one more exporter.
- **Context propagation through AsyncLocalStorage:** spans nest correctly across `await` and `Promise.all` with no ids passed around.
- **Usage is cost:** split cached input tokens for accurate cost. Measured: agent ≈ $0.0015 per answer, RAG ≈ $0.0005.
- **The first trace found a bottleneck:** 2.9 s of a 2.9 s retrieval was a cold OpenAI connection for the query embedding; search + rerank took ~70 ms.
- **Scores turn observability into evaluation:** filter for 👎 answers and open exactly what happened.
- **Batch, then flush on shutdown**, or the last spans are lost.
- **Feedback doesn't change the model.** It's for humans: 👎 trace → diagnose → new golden case → fix → eval gate.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Langfuse (cloud) | LangSmith, Arize Phoenix, Helicone, Datadog LLM Observability | ✅ LangSmith is tight with LangChain; Helicone needs no code; Datadog joins existing infra metrics. ❌ Helicone (a proxy) only sees LLM calls; Datadog is costly; LangSmith is less open |
| Manual spans per step | Auto-instrumentation only | ✅ Zero code. ❌ You only see LLM calls, not retrieval, guardrails or agent structure |
| Trace everything | Sampling, tail-based sampling | ✅ Cheaper at scale. ❌ Rare failures can be dropped unless sampling is tail-based |
| Full inputs/outputs logged | `mask` / redaction | ✅ Required for real PII. ❌ Harder debugging (fine here: never going live) |
| Background batches + flush | Immediate export | ✅ Nothing lost on crash; needed for serverless. ❌ Adds latency to requests |
| Trace id in the response body | Response header | ✅ Cleaner payload. ❌ Not typed in the shared contract |
| Plain-English logs | Structured JSON logs (pino) → Loki / ELK | ✅ Searchable, aggregatable; production standard. ❌ Harder to read while learning |
| 👍/👎 | Ratings, written corrections | ✅ Richer signal. ❌ Much lower response rate |

> **Soundbite:** "Every request is an OpenTelemetry trace exported to Langfuse: retriever spans, a generation per LLM call with tokens and cost, agent turns and tool calls with the MCP server's span nested inside, and the citation check as a guardrail span. The first trace showed 2.9 s of 'retrieval' was a cold embedding connection, not pgvector. Traces carry automatic scores and user feedback, so I can filter for bad answers, see exactly what the model saw, and turn them into eval cases."

---

## Step 10: Evals and a CI gate

**Built:** `pnpm eval` runs a 17-question golden set through both RAG and the agent. Code checks run first, then a calibrated `gpt-5` judge grades correctness against a reference answer. Per-mode averages are compared to gates and the process exits 1 on failure. With Langfuse keys, each run is an experiment on dataset `resume-qa-golden`. A GitHub Actions workflow runs it on relevant PRs.

**Files and main functions**

| File | What's in it |
|---|---|
| `apps/api/evals/golden.ts` | `GOLDEN_SET` (17 cases: 7 fact, 1 duration, 3 aggregate, 1 multi-part, 1 partial, 3 unanswerable, 1 injection), each with `expectedStatus`, `reference`, `mustMention`, `mustNotMention`, `evidence`; `monthsInclusive()`, `ym()`, `durationPattern()` (date-based references computed from today) |
| `apps/api/evals/judge.ts` | `judgeAnswer()` (gpt-5, 3-level rubric, reasoning before verdict, `VERDICT_SCORE`), `CALIBRATION` (5 hand-graded answers) |
| `apps/api/evals/scoring.ts` | `deterministicScores()` (status_ok, facts_coverage, no_forbidden, grounded, evidence_recall, evidence_mrr), `judgeScore()`, `summarize()` (means, p50 / p95, tokens), `byCategory()`, `GATES`, `checkGates()`, `normalize()` |
| `apps/api/evals/run.ts` | `main()` → judge calibration → load the sample resume → `syncDataset()` → `runMode()` (Langfuse `experiment.run` with item and run evaluators, or a local pool) → `runTask()` → `printMode()`, `markdownSummary()` (GitHub job summary), JSON report, exit code |
| `.github/workflows/evals.yml` | PR path filter + manual run, cancel-in-progress, pgvector service container, typecheck → migrate → eval, reranker cache, results uploaded |
| `apps/api/src/llm/structured.ts`, `env.ts`, `log.ts`, `observability/tracing.ts` | `model` / `reasoningEffort` options, `OPENAI_JUDGE_MODEL`, `sendLogsTo()`, exported `langfuse` |

**Gates** (set just under baseline; safety gates are absolute):

| Metric | RAG | Agent |
|---|---|---|
| task_errors | ≤ 0 | ≤ 0 |
| no_forbidden | ≥ 1 | ≥ 1 |
| status_ok | ≥ 0.8 | ≥ 0.9 |
| grounded | ≥ 0.9 | ≥ 0.9 |
| facts_coverage | ≥ 0.75 | ≥ 0.95 |
| evidence_recall | ≥ 0.75 | ≥ 0.95 |
| judge_correctness | ≥ 0.7 | ≥ 0.9 |

**Results (final run):** RAG judge 0.91, facts 0.90, recall 0.95, aggregate questions 0.50, p50 5.4 s, 12k input tokens. Agent: 1.00 on judge, facts and recall, grounded 0.94, p50 10.8 s, 82k input tokens.

**What we learned**
- **Offline vs online evals:** a golden set before merge vs scores on live traffic; flagged production traces become new golden cases.
- **Code checks first, judge second:** regexes, status and quote checks are free, exact and never flaky.
- **A trustworthy judge:** stronger model than the one graded, a reference answer, one narrow criterion, a 3-level scale, reasoning before the verdict, and **calibration** on hand-graded answers.
- **The judge can expose bad references:** it marked a correct team-size answer partial for omitting the employer, which the question didn't ask for. References now mark context as "not required".
- **Recall + correctness locate a failure:** RAG said "8 years" with evidence recall 1, so it's a generation bug, not retrieval. "All employers" missed Cartwheel, a retrieval failure.
- **Code catches what the judge misses:** a judged-correct agent answer had a non-verbatim quote.
- **Non-determinism:** single cases flip between runs; averages are steady. Gate on averages, ratchet thresholds up.
- **Datasets and experiments** make every change a measured comparison.

**Used vs alternatives**

| Used | Alternative | Pros and cons of the alternative |
|---|---|---|
| Golden set as TS in the repo, synced to Langfuse | Langfuse-only dataset, YAML / JSON | ✅ Non-engineers can edit. ❌ Doesn't change in the same PR as the code; can't compute date-based references |
| Own scoring + Langfuse experiments | RAGAS, DeepEval, promptfoo, OpenAI Evals | ✅ Ready-made metrics (faithfulness, context precision), test-set generation. ❌ RAGAS / DeepEval are Python; faithfulness would duplicate our deterministic quote check |
| gpt-5 judge with reference | Same-model judge, no reference, pairwise A vs B | ✅ Cheaper; pairwise is best for comparing two versions. ❌ Self-preference bias; noisy without a reference; pairwise needs two runs |
| 3-level scale | 1–10, per-criterion yes/no | ✅ Per-criterion yes/no is most stable. ❌ 1–10 drifts; per-criterion needs more calls |
| Gates on averages | Must-pass cases, repeated runs with confidence intervals | ✅ Catch specific regressions; statistically sound. ❌ Flaky; N× cost |
| Run on relevant PRs | Every push, nightly | ✅ Nightly catches provider drift. ❌ Every push costs more |
| 17 cases, one resume | Hundreds of cases, many resumes | ✅ Broader coverage, finds format-specific chunking bugs. ❌ Expensive to write and check by hand |
| Deterministic checks inline, LLM metrics offline | RAGAS-style LLM metrics in the request path | ✅ Catches unsupported reasoning. ❌ Seconds and money per request, non-deterministic, returns a score not an action |

> **Soundbite:** "Evals are a golden set in the repo: 17 questions covering facts, durations, whole-resume aggregates, unanswerable questions and a prompt injection. Code checks run first, then a gpt-5 judge grades correctness against a reference after I calibrate it on hand-graded answers. Each run is a Langfuse experiment, and CI fails the PR if an average drops below its gate. It paid off immediately: RAG said '8 years' with 100% evidence recall, which made it a generation bug, and the agent with a date calculator got all 17 right."

---

## Concept reference

**RAG pipeline in one line:** chunk → embed → store, then for each question: embed → retrieve (hybrid) → rerank → build sources → generate with citations → verify.

**Chunking techniques**

| Technique | How it works |
|---|---|
| **Structure-aware parent-child + context headers (ours)** | Split by headings and entries; embed bullets with a context header, give the model the whole entry |
| Fixed-size | Cut every N tokens; simple but splits facts |
| Sliding window (overlap) | Fixed-size with repeated overlap so boundary facts appear whole (our fallback) |
| Recursive splitting | Try paragraph, then line, sentence, word separators until under the size limit |
| Sentence / paragraph | Split on sentence boundaries or blank lines, group up to a limit |
| Semantic | Start a new chunk where neighbouring sentence embeddings diverge |
| Sentence window | Embed sentences; return the hit with ±N neighbours |
| Contextual retrieval | An LLM writes a short situating summary prepended to each chunk |
| Proposition / agentic | An LLM rewrites text into atomic facts, one per chunk |
| Late chunking | Embed the whole document, then pool token embeddings per chunk |
| RAPTOR | Cluster and recursively summarize chunks into a searchable tree |

**Rerankers**

| Reranker | How it works |
|---|---|
| **Cross-encoder (ours: MiniLM-L-6)** | Reads query and chunk together, outputs one relevance score |
| Bigger open-source cross-encoders | bge-reranker, mxbai, Jina: same idea, more accurate, slower |
| Hosted APIs | Cohere / Voyage / Jina rerank: no hosting, per-call cost |
| LLM pointwise / listwise / pairwise | Rate each chunk; order the whole list (RankGPT); compare pairs |
| Late interaction (ColBERT) | Per-token vectors scored with MaxSim |
| RRF (ours, before reranking) | `Σ 1/(k + rank)` over several ranked lists |
| MMR | Trades relevance against diversity to avoid near-duplicates |
| Rule / metadata boosts | Recency, document type, department filters |

**Verification (guardrails) in this system**
1. `sourceId` is a Zod enum of the real source ids, so invalid citations can't be generated.
2. `locateQuote` finds each quote in the cited source (exact, then normalized) and returns its character span for highlighting.
3. A claim whose quotes aren't found is marked unsupported and counted in the `unsupported_claims` score. The agent checks quotes against the outputs of tools it actually called.

**Scaling the design to a multi-department document system** (e.g. HR, Legal, Sales, Purchase):
- Chunk by each document type's structure (headings, clauses, table rows), with context headers like `HR > Leave Policy v3 > 4.2 Maternity Leave`.
- Attach metadata to every chunk: department, document, version, `is_current`, access groups.
- Keep one index. A selected department, a router's guess or a search-everything pass becomes a **pre-filter** at query time.
- Enforce access control in the SQL query, never in the prompt.
