-- 003: verified-PYQ provenance and review, versioned exam patterns, email delivery log.
-- Additive for learner data: no attempt, mastery, revision, lesson, plan or mock row is changed.

-- ---------------------------------------------------------------- question provenance and review
ALTER TABLE questions
  ADD COLUMN question_number int CHECK (question_number IS NULL OR question_number > 0),
  ADD COLUMN answer_key_verification text NOT NULL DEFAULT 'not_applicable'
    CHECK (answer_key_verification IN ('verified', 'unverified', 'not_applicable')),
  ADD COLUMN review_status text NOT NULL DEFAULT 'not_required'
    CHECK (review_status IN ('not_required', 'pending', 'approved', 'rejected')),
  ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text NOT NULL DEFAULT '',
  ADD COLUMN import_job_id uuid REFERENCES content_import_jobs(id) ON DELETE SET NULL;

-- Questions already stored as authentic PYQs were published under the older rule (paper source
-- only). They go back through review so their answer key is checked too.
INSERT INTO audit_logs(action, entity_type, entity_id, details)
SELECT 'question.review_required', 'question', id::text, jsonb_build_object('reason', 'migration 003: answer-key verification and admin approval now required', 'previous_status', status)
  FROM questions WHERE origin = 'authentic_pyq';
UPDATE questions
   SET answer_key_verification = 'unverified', review_status = 'pending',
       status = CASE WHEN status = 'published' THEN 'unpublished' ELSE status END
 WHERE origin = 'authentic_pyq';

-- Memory-based reconstructions ('reconstructed') may carry the year/slot they claim to come
-- from. They are shown as unverified historical questions and never as CAT PYQs.
ALTER TABLE questions DROP CONSTRAINT questions_check1;
ALTER TABLE questions DROP CONSTRAINT questions_check2;
ALTER TABLE questions
  ADD CONSTRAINT questions_paper_fields_historical_only
    CHECK (origin IN ('authentic_pyq', 'reconstructed') OR (exam_year IS NULL AND exam_slot IS NULL AND question_number IS NULL)),
  ADD CONSTRAINT questions_source_verification_scope
    CHECK (origin IN ('authentic_pyq', 'reconstructed') OR source_verification = 'not_applicable'),
  ADD CONSTRAINT questions_answer_key_scope
    CHECK (origin = 'authentic_pyq' OR answer_key_verification = 'not_applicable'),
  -- Nothing reaches learners labelled as a CAT PYQ unless its paper source, answer key and
  -- solution were verified and an admin approved it.
  ADD CONSTRAINT questions_published_pyq_verified
    CHECK (origin <> 'authentic_pyq' OR status <> 'published' OR (
      source_verification = 'verified' AND answer_key_verification = 'verified' AND solution_verification = 'verified'
      AND review_status = 'approved' AND exam_year IS NOT NULL));

CREATE UNIQUE INDEX questions_pyq_number_uniq
  ON questions (exam_year, coalesce(exam_slot, 0), section_id, question_number)
  WHERE origin = 'authentic_pyq' AND question_number IS NOT NULL;
CREATE INDEX questions_review_idx ON questions (review_status) WHERE review_status IN ('pending', 'rejected');

ALTER TABLE question_sources
  ADD COLUMN kind text NOT NULL DEFAULT 'question_paper' CHECK (kind IN ('question_paper', 'answer_key', 'solution', 'other')),
  ADD COLUMN recorded_answer text,          -- for kind = 'answer_key': the answer the key gives
  ADD COLUMN accessed_on date;

-- Passages and DILR sets are reviewed with their questions: the passage text is part of the paper.
ALTER TABLE passages
  ADD COLUMN source_name text NOT NULL DEFAULT '',
  ADD COLUMN source_reference text NOT NULL DEFAULT '',
  ADD COLUMN source_url text,
  ADD COLUMN source_verification text NOT NULL DEFAULT 'not_applicable' CHECK (source_verification IN ('verified', 'unverified', 'not_applicable')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE dilr_sets
  ADD COLUMN source_name text NOT NULL DEFAULT '',
  ADD COLUMN source_reference text NOT NULL DEFAULT '',
  ADD COLUMN source_url text,
  ADD COLUMN source_verification text NOT NULL DEFAULT 'not_applicable' CHECK (source_verification IN ('verified', 'unverified', 'not_applicable')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE passages SET source_verification = 'unverified' WHERE origin = 'authentic_pyq';
UPDATE dilr_sets SET source_verification = 'unverified' WHERE origin = 'authentic_pyq';

-- Revisions of passages and sets, like question_versions for questions.
CREATE TABLE group_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_type  text NOT NULL CHECK (group_type IN ('passage', 'dilr_set')),
  group_id    uuid NOT NULL,
  snapshot    jsonb NOT NULL,
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_versions_idx ON group_versions (group_type, group_id, created_at DESC);

ALTER TABLE content_import_jobs
  ADD COLUMN format text NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'jsonl', 'csv')),
  ADD COLUMN file_sha256 text;

-- ---------------------------------------------------------------- versioned exam patterns
-- Each change is a new version; old versions stay as they were so mocks scored under them
-- keep their meaning. Exactly one configuration is active for new mocks.
ALTER TABLE exam_configs DROP CONSTRAINT exam_configs_year_key;
ALTER TABLE exam_configs
  ADD COLUMN version int NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN is_active boolean NOT NULL DEFAULT false,
  ADD COLUMN supersedes_id uuid REFERENCES exam_configs(id) ON DELETE SET NULL,
  -- setting -> {status: verified|unverified, sourceId, verifiedBy, verifiedAt}
  ADD COLUMN field_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT exam_configs_year_version_key UNIQUE (year, version);
CREATE UNIQUE INDEX exam_configs_one_active ON exam_configs ((true)) WHERE is_active;
-- Keep the previous behaviour: the latest year was used for new mocks.
UPDATE exam_configs SET is_active = true WHERE id = (SELECT id FROM exam_configs ORDER BY year DESC, created_at DESC LIMIT 1);

CREATE TABLE exam_config_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_config_id  uuid NOT NULL REFERENCES exam_configs(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('official', 'secondary')),
  title           text NOT NULL,
  publisher       text NOT NULL DEFAULT '',
  url             text,
  accessed_on     date,
  supports        text NOT NULL DEFAULT '',  -- what this source states, in the reviewer's words
  note            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exam_config_sources_cfg_idx ON exam_config_sources (exam_config_id);

-- ---------------------------------------------------------------- email delivery
ALTER TABLE password_reset_tokens ADD COLUMN revoked_at timestamptz;
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);

-- Delivery outcomes only: never the token, link or message body.
CREATE TABLE email_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose             text NOT NULL,
  provider            text NOT NULL,
  status              text NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed')),
  error               text,
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_deliveries_created_idx ON email_deliveries (created_at DESC);
