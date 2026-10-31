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
