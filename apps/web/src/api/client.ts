import axios, { type AxiosRequestConfig } from "axios";
import type { z } from "zod";
import {
  ApiErrorSchema,
  ChunkListResponseSchema,
  ExtractResponseSchema,
  HealthResponseSchema,
  IngestResponseSchema,
  SaveProfileResponseSchema,
  type ExtractRequest,
  type IngestRequest,
  type SaveProfileRequest,
} from "@resume-agent/shared";

const http = axios.create({ baseURL: "/api", timeout: 120_000 });

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// Every response is parsed with the shared contract, so a backend change that breaks the
// contract fails loudly here instead of as `undefined` deep inside a component.
async function request<T>(schema: z.ZodType<T>, config: AxiosRequestConfig): Promise<T> {
  try {
    const res = await http.request(config);
    return schema.parse(res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = ApiErrorSchema.safeParse(err.response?.data);
      if (body.success) throw new ApiClientError(body.data.error.code, body.data.error.message, body.data.error.details);
      throw new ApiClientError("NETWORK", err.message);
    }
    throw err;
  }
}

export const api = {
  health: () => request(HealthResponseSchema, { method: "get", url: "/health", validateStatus: () => true }),
  extract: (body: ExtractRequest) => request(ExtractResponseSchema, { method: "post", url: "/extract", data: body }),
  ingest: (body: IngestRequest) => request(IngestResponseSchema, { method: "post", url: "/resumes", data: body }),
  chunks: (resumeId: string) => request(ChunkListResponseSchema, { method: "get", url: `/resumes/${resumeId}/chunks` }),
  saveProfile: (body: SaveProfileRequest) => request(SaveProfileResponseSchema, { method: "post", url: "/profiles", data: body }),
};
