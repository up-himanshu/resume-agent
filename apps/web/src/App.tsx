import { useCallback, useRef, useState } from "react";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import sampleResume from "../../../samples/resume-priya.txt?raw";
import { useExtract, useHealth, useIngest, useSaveProfile } from "./api/hooks.js";
import { ProfileForm } from "./form/ProfileForm.js";
import { defaultValues, form, formSchema, type ProfileValues } from "./form/schema.js";
import { SuggestionsPanel } from "./review/SuggestionsPanel.js";
import { ChunkList } from "./review/ChunkList.js";
import { SearchPanel } from "./review/SearchPanel.js";
import type { Span } from "./review/SuggestionCard.js";

export function App() {
  const methods = useForm<ProfileValues>({
    resolver: zodResolver(formSchema) as Resolver<ProfileValues>,
    defaultValues,
    mode: "onBlur",
  });
  const health = useHealth();
  const extract = useExtract();
  const ingest = useIngest();
  const saveProfile = useSaveProfile();
  // Uncontrolled textarea: typing a long resume doesn't re-render the app on each keystroke.
  const resumeRef = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState<ProfileValues | null>(null);

  // Two independent requests in parallel: suggestions for the form, and indexing for Q&A.
  const process = () => {
    const resumeText = resumeRef.current?.value ?? "";
    extract.mutate({ resumeText });
    ingest.mutate({ resumeText });
  };

  // Spans refer to the text that was submitted; if the user edited it since, offsets may be off.
  const showEvidence = useCallback(
    (span: Span) => {
      const el = resumeRef.current;
      if (!el) return;
      if (el.value !== extract.variables?.resumeText) {
        alert("The resume text changed since it was processed, so the highlight may be off.");
      }
      el.focus();
      el.setSelectionRange(span.start, span.end);
    },
    [extract.variables],
  );

  // Client validation first (fast feedback), then the server validates again before storing.
  const onSubmit = methods.handleSubmit((values) => {
    setSaved(values);
    saveProfile.mutate({
      resumeId: ingest.data?.resumeId ?? null,
      formId: form.id,
      formVersion: form.version,
      values,
    });
  });

  return (
    <div className="app">
      <header className="topbar">
        <h1>Resume → Profile</h1>
        <span className={`badge ${health.data?.status === "ok" ? "good" : "bad"}`}>
          API {health.isPending ? "…" : health.data?.status === "ok" ? "ok" : "unavailable"}
        </span>
      </header>

      <main className="columns">
        <section className="column">
          <h2>1. Paste your resume</h2>
          <textarea ref={resumeRef} className="resume" placeholder="Paste resume text here…" spellCheck={false} />
          <div className="actions">
            <button type="button" onClick={process} disabled={extract.isPending}>
              {extract.isPending ? "Processing…" : "Process"}
            </button>
            <button type="button" className="secondary" onClick={() => resumeRef.current && (resumeRef.current.value = sampleResume)}>
              Load sample
            </button>
          </div>
          {extract.isError && <p className="field-error" role="alert">{extract.error.message}</p>}
          {ingest.isPending && <p className="muted">Indexing resume for Q&amp;A…</p>}
          {ingest.isError && <p className="field-error" role="alert">Indexing failed: {ingest.error.message}</p>}
          {ingest.data && (
            <details className="index-status">
              <summary>
                <span className="badge good">Indexed for Q&amp;A</span>{" "}
                {ingest.data.chunkCounts.parents} parents · {ingest.data.chunkCounts.children} embedded children
                {ingest.data.reused
                  ? " · already indexed, reused (no embedding cost)"
                  : ` · ${ingest.data.embedding?.tokens} tokens · ${ingest.data.embedding?.latencyMs}ms`}
                {" · "}view chunks
              </summary>
              <ChunkList resumeId={ingest.data.resumeId} />
            </details>
          )}
          {ingest.data && (
            <>
              <h2>Search your resume (retrieval only)</h2>
              <SearchPanel resumeId={ingest.data.resumeId} />
            </>
          )}

          <FormProvider {...methods}>
            {extract.data && (
              <>
                <h2>2. Review suggestions</h2>
                <SuggestionsPanel key={extract.submittedAt} result={extract.data} onShowEvidence={showEvidence} />
              </>
            )}
          </FormProvider>
        </section>

        <section className="column">
          <h2>3. Your profile</h2>
          <FormProvider {...methods}>
            <form onSubmit={onSubmit} noValidate>
              <ProfileForm />
              <div className="actions sticky">
                <button type="submit">Save profile</button>
                <button type="button" className="secondary" onClick={() => { methods.reset(defaultValues); setSaved(null); saveProfile.reset(); }}>
                  Clear
                </button>
              </div>
            </form>
          </FormProvider>
          {saveProfile.isPending && <p className="muted">Saving…</p>}
          {saveProfile.isError && <p className="field-error" role="alert">Save failed: {saveProfile.error.message}</p>}
          {saveProfile.data && (
            <p className="saved-status">
              <span className="badge good">Saved to database</span> profile {saveProfile.data.profileId} at{" "}
              {new Date(saveProfile.data.savedAt).toLocaleTimeString()}
              {ingest.data ? `, linked to resume ${ingest.data.resumeId.slice(0, 8)}…` : ", not linked to a resume"}
            </p>
          )}
          {saved && (
            <details className="saved">
              <summary>Submitted values</summary>
              <pre>{JSON.stringify(saved, null, 2)}</pre>
            </details>
          )}
        </section>
      </main>
    </div>
  );
}
