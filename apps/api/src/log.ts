import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

// Every log line carries the request id of the request that produced it. AsyncLocalStorage
// follows the async call chain, so we don't have to pass the id through every function.
// This matters once calls run in parallel and their lines interleave.
const context = new AsyncLocalStorage<{ requestId: string }>();

export const requestContext: RequestHandler = (_req, _res, next) => {
  context.run({ requestId: randomUUID().slice(0, 8) }, next);
};

function prefix(scope: string): string {
  const time = new Date().toISOString().slice(11, 23);
  const requestId = context.getStore()?.requestId ?? "--------";
  return `${time} [req ${requestId}] [${scope}]`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
}

/** One step of the pipeline, in plain English, optionally followed by its data. */
export function log(scope: string, message: string, data?: unknown): void {
  console.log(`${prefix(scope)} ${message}`);
  if (data !== undefined) {
    console.log(indent(typeof data === "string" ? data : JSON.stringify(data, null, 2)));
  }
}

/** A large piece of text (a prompt, a resume, raw model output), framed so it's easy to spot. */
export function logBlock(scope: string, title: string, text: string): void {
  console.log(`${prefix(scope)} ┌── ${title} (${text.length} chars) ──`);
  console.log(indent(text));
  console.log(`${prefix(scope)} └── end of ${title} ──`);
}
