CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE mutation_type AS ENUM (
  'DIRECT_QUOTE', 'PARAPHRASE', 'MISSING_CONTEXT', 'OVERGENERALIZATION',
  'UNSUPPORTED_INFERENCE', 'MISATTRIBUTION', 'TRANSLATION_DRIFT'
);
CREATE TYPE verification_status AS ENUM (
  'SUPPORTED', 'PARTIALLY_SUPPORTED', 'NEEDS_CONTEXT', 'UNSUPPORTED', 'REQUIRES_SPECIALIST'
);
CREATE TYPE processing_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE input_type AS ENUM ('TEXT', 'IMAGE');

CREATE TABLE approved_sources (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('QURAN', 'HADITH', 'TAFSIR', 'SCHOLARLY_REFERENCE')),
  canonical_url text NOT NULL,
  language text NOT NULL,
  edition text NOT NULL,
  license_notes text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  scope_notes text NOT NULL
);

CREATE TABLE source_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approved_source_id text NOT NULL REFERENCES approved_sources(id) ON DELETE RESTRICT,
  title text NOT NULL,
  author text,
  locator text NOT NULL,
  url text,
  edition text,
  accessed_at timestamptz
);

CREATE TABLE analysis_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_type input_type NOT NULL,
  processing_status processing_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK ((processing_status = 'COMPLETED') = (completed_at IS NOT NULL))
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_report_id uuid NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(trim(text)) > 0),
  input_span_start integer,
  input_span_end integer,
  verification_status verification_status,
  UNIQUE (id, analysis_report_id),
  CHECK ((input_span_start IS NULL AND input_span_end IS NULL) OR
    (input_span_start IS NOT NULL AND input_span_end IS NOT NULL AND input_span_start >= 0 AND input_span_end > input_span_start))
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_reference_id uuid NOT NULL REFERENCES source_references(id) ON DELETE RESTRICT,
  original_text text NOT NULL CHECK (length(trim(original_text)) > 0),
  context text,
  language text NOT NULL DEFAULT 'ar',
  embedding vector,
  embedding_model text,
  CHECK ((embedding IS NULL) = (embedding_model IS NULL))
);

CREATE TABLE evidence_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_report_id uuid NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  predecessor_relation_id uuid,
  mutation_type mutation_type NOT NULL,
  explanation text NOT NULL,
  preserved_text text NOT NULL,
  published_text text NOT NULL,
  UNIQUE (id, analysis_report_id),
  FOREIGN KEY (claim_id, analysis_report_id) REFERENCES claims(id, analysis_report_id) ON DELETE CASCADE,
  FOREIGN KEY (predecessor_relation_id, analysis_report_id) REFERENCES evidence_relations(id, analysis_report_id),
  CHECK (predecessor_relation_id IS NULL OR predecessor_relation_id <> id)
);

CREATE TABLE yaqeen_patches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_report_id uuid NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL,
  original_text text NOT NULL,
  corrected_text text NOT NULL,
  rationale text NOT NULL,
  reviewed_at timestamptz,
  FOREIGN KEY (claim_id, analysis_report_id) REFERENCES claims(id, analysis_report_id) ON DELETE CASCADE
);

CREATE TABLE patch_evidence (
  patch_id uuid NOT NULL REFERENCES yaqeen_patches(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  PRIMARY KEY (patch_id, evidence_id)
);

CREATE INDEX source_references_source_idx ON source_references(approved_source_id);
CREATE INDEX claims_report_idx ON claims(analysis_report_id);
CREATE INDEX evidence_source_idx ON evidence(source_reference_id);
CREATE INDEX evidence_relations_claim_idx ON evidence_relations(claim_id, analysis_report_id);
CREATE INDEX evidence_relations_evidence_idx ON evidence_relations(evidence_id);
CREATE INDEX evidence_relations_predecessor_idx ON evidence_relations(predecessor_relation_id, analysis_report_id);
CREATE INDEX patches_claim_idx ON yaqeen_patches(claim_id, analysis_report_id);
CREATE INDEX patch_evidence_evidence_idx ON patch_evidence(evidence_id);

-- No seeds or vector indexes. Choose model + dimensions before adding embeddings.
