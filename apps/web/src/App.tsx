import { useCallback, useRef, useState } from "react";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import sampleResume from "../../../samples/resume-priya.txt?raw";
import { useExtract, useHealth } from "./api/hooks.js";
import { ProfileForm } from "./form/ProfileForm.js";
import { defaultValues, formSchema, type ProfileValues } from "./form/schema.js";
import { SuggestionsPanel } from "./review/SuggestionsPanel.js";
import type { Span } from "./review/SuggestionCard.js";

export function App() {
  const methods = useForm<ProfileValues>({
    resolver: zodResolver(formSchema) as Resolver<ProfileValues>,
    defaultValues,
    mode: "onBlur",
  });
  const health = useHealth();
  const extract = useExtract();
  // Uncontrolled textarea: typing a long resume doesn't re-render the app on each keystroke.
  const resumeRef = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState<ProfileValues | null>(null);

  const process = () => {
    const resumeText = resumeRef.current?.value ?? "";
    extract.mutate({ resumeText });
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

  const onSubmit = methods.handleSubmit((values) => setSaved(values));

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
                <button type="button" className="secondary" onClick={() => { methods.reset(defaultValues); setSaved(null); }}>
                  Clear
                </button>
              </div>
            </form>
          </FormProvider>
          {saved && (
            <details className="saved" open>
              <summary>✓ Profile valid. Submitted values</summary>
              <pre>{JSON.stringify(saved, null, 2)}</pre>
            </details>
          )}
        </section>
      </main>
    </div>
  );
}
