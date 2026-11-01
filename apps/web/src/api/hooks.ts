import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./client.js";

// Server state lives in React Query, not in component state: caching, refetching, loading and
// error flags come for free. Queries read; mutations change things or trigger work.

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
}

export function useExtract() {
  return useMutation({ mutationFn: api.extract });
}

export function useIngest() {
  return useMutation({ mutationFn: api.ingest });
}

// A query keyed by resume id: fetched once per resume, cached, and only enabled once we have an id.
export function useChunks(resumeId: string | undefined) {
  return useQuery({
    queryKey: ["chunks", resumeId],
    queryFn: () => api.chunks(resumeId!),
    enabled: Boolean(resumeId),
    staleTime: Infinity, // chunks of a stored resume never change
  });
}

export function useSaveProfile() {
  return useMutation({ mutationFn: api.saveProfile });
}
