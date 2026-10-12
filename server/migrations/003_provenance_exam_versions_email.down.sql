-- Reverses 003. Memory-based questions lose the year/slot they carried, because the older
-- schema allowed exam metadata only on authentic PYQs. Older exam-pattern versions are removed
-- (newest version per year is kept) because the older schema allowed one pattern per year.
DROP TABLE IF EXISTS email_deliveries;
DROP INDEX IF EXISTS password_reset_tokens_user_idx;
ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS revoked_at;

DROP TABLE IF EXISTS exam_config_sources;
DROP INDEX IF EXISTS exam_configs_one_active;
UPDATE mock_tests m SET exam_config_id = keep.id
  FROM exam_configs old
  JOIN LATERAL (SELECT id FROM exam_configs k WHERE k.year = old.year ORDER BY version DESC LIMIT 1) keep ON true
 WHERE m.exam_config_id = old.id AND old.id <> keep.id;
DELETE FROM exam_configs c WHERE EXISTS (SELECT 1 FROM exam_configs n WHERE n.year = c.year AND n.version > c.version);
ALTER TABLE exam_configs DROP CONSTRAINT IF EXISTS exam_configs_year_version_key;
ALTER TABLE exam_configs
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS supersedes_id,
  DROP COLUMN IF EXISTS field_status,
  DROP COLUMN IF EXISTS verified_by,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS created_by;
ALTER TABLE exam_configs ADD CONSTRAINT exam_configs_year_key UNIQUE (year);

ALTER TABLE content_import_jobs DROP COLUMN IF EXISTS format, DROP COLUMN IF EXISTS file_sha256;
DROP TABLE IF EXISTS group_versions;
ALTER TABLE passages DROP COLUMN source_name, DROP COLUMN source_reference, DROP COLUMN source_url, DROP COLUMN source_verification, DROP COLUMN updated_at;
ALTER TABLE dilr_sets DROP COLUMN source_name, DROP COLUMN source_reference, DROP COLUMN source_url, DROP COLUMN source_verification, DROP COLUMN updated_at;
ALTER TABLE question_sources DROP COLUMN kind, DROP COLUMN recorded_answer, DROP COLUMN accessed_on;

DROP INDEX IF EXISTS questions_review_idx;
DROP INDEX IF EXISTS questions_pyq_number_uniq;
ALTER TABLE questions
  DROP CONSTRAINT questions_published_pyq_verified,
  DROP CONSTRAINT questions_answer_key_scope,
  DROP CONSTRAINT questions_source_verification_scope,
  DROP CONSTRAINT questions_paper_fields_historical_only;
UPDATE questions SET exam_year = NULL, exam_slot = NULL, source_verification = 'not_applicable' WHERE origin <> 'authentic_pyq';
ALTER TABLE questions
  ADD CONSTRAINT questions_check1 CHECK (origin = 'authentic_pyq' OR (exam_year IS NULL AND exam_slot IS NULL)),
  ADD CONSTRAINT questions_check2 CHECK (origin = 'authentic_pyq' OR source_verification = 'not_applicable');
ALTER TABLE questions
  DROP COLUMN question_number,
  DROP COLUMN answer_key_verification,
  DROP COLUMN review_status,
  DROP COLUMN reviewed_by,
  DROP COLUMN reviewed_at,
  DROP COLUMN review_note,
  DROP COLUMN import_job_id;
