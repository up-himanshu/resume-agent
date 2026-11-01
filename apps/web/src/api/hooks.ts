import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  // A newly indexed resume should show up in the picker: mark the cached list stale so it refetches.
  return useMutation({ mutationFn: api.ingest, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["resumes"] }) });
}

export function useResumes() {
  return useQuery({ queryKey: ["resumes"], queryFn: api.resumes });
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

// A search is a read, so it's a query (cached by its inputs), not a mutation: repeating a search
// is instant, and React Query dedupes identical in-flight requests.
export function useSearch(resumeId: string, query: string | null, rerank: boolean) {
  return useQuery({
    queryKey: ["search", resumeId, query, rerank],
    queryFn: () => api.search(resumeId, { query: query!, k: 5, rerank }),
    enabled: Boolean(query),
    staleTime: Infinity,
  });
}

// Asking is a mutation even though it reads: the answer is generated (non-deterministic, costs
// tokens), so it should run only when the user clicks, and asking again should really ask again.
export function useAsk(resumeId: string) {
  return useMutation({ mutationFn: (question: string) => api.ask(resumeId, { question }) });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  // The picker labels resumes by their latest saved profile's name.
  return useMutation({ mutationFn: api.saveProfile, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["resumes"] }) });
}
