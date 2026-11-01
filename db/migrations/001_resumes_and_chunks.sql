-- Resumes and their chunks for retrieval (RAG).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE resumes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content         text NOT NULL,
  -- sha256 of the content: re-processing the same resume reuses its chunks instead of paying
  -- for embeddings again. Scoped by model, because vectors from different models aren't comparable.
  content_hash    text NOT NULL,
  embedding_model text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_hash, embedding_model)
);

-- Parent-child chunking: small "child" chunks are embedded and searched (precise matches);
-- each points to a larger "parent" (a whole role or section entry) that is given to the model
-- as context. Parents have no embedding.
CREATE TABLE resume_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id   uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES resume_chunks(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('parent', 'child')),
  section     text NOT NULL,
  chunk_index int  NOT NULL,
  -- What gets embedded: for children, the source text plus a short context header
  -- ("Experience > Brightline Health — Senior Frontend Engineer: ...").
  content     text NOT NULL,
  -- The exact resume text this chunk covers, and where, for citations and highlighting.
  source_text text NOT NULL,
  char_start  int  NOT NULL,
  char_end    int  NOT NULL,
  -- 1536 = output size of text-embedding-3-small. Must match the model, or inserts fail.
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'child') = (embedding IS NOT NULL))
);

CREATE INDEX resume_chunks_resume_id_idx ON resume_chunks (resume_id);

-- Approximate nearest-neighbour index for cosine distance (the <=> operator).
-- HNSW: a layered graph; fast queries and good recall, slower to build than IVFFlat.
CREATE INDEX resume_chunks_embedding_hnsw_idx ON resume_chunks USING hnsw (embedding vector_cosine_ops);
