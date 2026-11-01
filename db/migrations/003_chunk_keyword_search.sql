-- Keyword (lexical) search over chunks, for hybrid retrieval alongside vector search.
-- A generated column: Postgres computes it from `content` on every insert/update, so it can't drift.
-- to_tsvector('english', ...) lowercases, drops stop words ("the", "where") and stems words
-- ("engineers" -> "engin", "leading" -> "lead"; but "led" stays "led"), producing searchable lexemes.
ALTER TABLE resume_chunks
  ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- GIN = inverted index: lexeme -> rows containing it. The standard index for full-text search.
CREATE INDEX resume_chunks_search_tsv_idx ON resume_chunks USING gin (search_tsv);
