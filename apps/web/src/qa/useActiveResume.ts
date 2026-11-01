import { useCallback, useEffect, useState } from "react";

const PARAM = "resume";

function readFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

/**
 * The resume that search and Q&A act on, kept in the URL (?resume=<id>) so a refresh or a shared
 * link opens the same resume. The URL is the source of truth; state just mirrors it for rendering.
 */
export function useActiveResume() {
  const [resumeId, setResumeId] = useState<string | null>(readFromUrl);

  // Back/forward buttons change the URL without our setter, so listen for them.
  useEffect(() => {
    const onPop = () => setResumeId(readFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(PARAM, id);
    else url.searchParams.delete(PARAM);
    // pushState, not replaceState: each picked resume is a history entry you can go back to.
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setResumeId(id);
  }, []);

  return [resumeId, select] as const;
}
