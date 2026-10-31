import type { ErrorRequestHandler } from "express";
import type { ApiError } from "@resume-agent/shared";
import { z } from "zod";
import { log } from "../log.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, "INVALID_REQUEST", "Request validation failed", issuesOf(result.error));
  }
  return result.data;
}

export function issuesOf(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

// Express 5 forwards rejected promises from async handlers here, so routes can just throw.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let body: ApiError;
  let status: number;
  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    body = { error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } };
  } else {
    console.error(err);
    status = 500;
    body = { error: { code: "INTERNAL", message: "Unexpected server error" } };
  }
  log("http", `Request failed: responding ${status} ${body.error.code}: ${body.error.message}`, body.error.details);
  res.status(status).json(body);
};
