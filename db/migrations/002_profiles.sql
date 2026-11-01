-- Saved profiles. Values live in one jsonb column rather than one column per field:
-- with a config-driven form of 150+ fields, adding a field shouldn't need a DB migration.
-- form_id + form_version record which config the values were validated against.
CREATE TABLE profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lineage: which resume the suggestions came from (kept if the resume is deleted).
  resume_id    uuid REFERENCES resumes(id) ON DELETE SET NULL,
  form_id      text NOT NULL,
  form_version int  NOT NULL,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_resume_id_idx ON profiles (resume_id);
