-- CAT 100 initial schema.
-- Conventions: UUID primary keys for user-owned and content rows, text slugs for
-- syllabus identifiers, timestamptz everywhere, ON DELETE CASCADE for user-owned data
-- so account deletion removes everything a learner owns.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- users & auth
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'learner' CHECK (role IN ('learner', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  csrf_token  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name         text NOT NULL DEFAULT '',
  education            text NOT NULL DEFAULT 'B.Tech in Computer Science',
  current_status       text NOT NULL DEFAULT 'Full-time software engineer',
  current_level        text NOT NULL DEFAULT 'beginner_intermediate',
  qa_self_rating       text NOT NULL DEFAULT 'weak'      CHECK (qa_self_rating   IN ('weak', 'needs_improvement', 'average', 'strong')),
  varc_self_rating     text NOT NULL DEFAULT 'needs_improvement' CHECK (varc_self_rating IN ('weak', 'needs_improvement', 'average', 'strong')),
  dilr_self_rating     text NOT NULL DEFAULT 'needs_improvement' CHECK (dilr_self_rating IN ('weak', 'needs_improvement', 'average', 'strong')),
  workday_minutes      int  NOT NULL DEFAULT 60  CHECK (workday_minutes BETWEEN 10 AND 600),
  weekend_minutes      int  NOT NULL DEFAULT 120 CHECK (weekend_minutes BETWEEN 0 AND 720),
  off_days             int[] NOT NULL DEFAULT '{}',         -- 0=Sunday .. 6=Saturday, days with no study
  weekend_days         int[] NOT NULL DEFAULT '{0,6}',
  goal                 text NOT NULL DEFAULT 'Target 100 percentile',
  learning_style       text NOT NULL DEFAULT 'Deep explanations, worked examples, substantial PYQ practice, complete solutions',
  exam_year            int  NOT NULL DEFAULT 2026 CHECK (exam_year BETWEEN 2015 AND 2100),
  exam_date            date,
  preparation_mode     text NOT NULL DEFAULT 'A' CHECK (preparation_mode IN ('A', 'B')),
  low_time_mode        boolean NOT NULL DEFAULT false,
  gamification_enabled boolean NOT NULL DEFAULT true,
  onboarding_completed boolean NOT NULL DEFAULT false,
  diagnostic_completed_at timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- syllabus
CREATE TABLE sections (
  id        text PRIMARY KEY,          -- 'VARC', 'DILR', 'QA'
  name      text NOT NULL,
  position  int  NOT NULL
);

CREATE TABLE topics (
  id              text PRIMARY KEY,    -- slug, e.g. 'qa-percentages'
  section_id      text NOT NULL REFERENCES sections(id),
  area            text NOT NULL,       -- e.g. 'Arithmetic', 'Reading Comprehension'
  name            text NOT NULL,
  position        int  NOT NULL,
  summary         text NOT NULL DEFAULT '',
  concept_md      text NOT NULL DEFAULT '',
  traps_md        text NOT NULL DEFAULT '',
  revision_md     text NOT NULL DEFAULT '',
  mastery_criteria text NOT NULL DEFAULT '',
  content_status  text NOT NULL DEFAULT 'outline' CHECK (content_status IN ('outline', 'complete')),
  estimated_hours numeric(5,1) NOT NULL DEFAULT 3,
  UNIQUE (section_id, name)
);
CREATE INDEX topics_section_idx ON topics(section_id, position);

CREATE TABLE subtopics (
  id        text PRIMARY KEY,
  topic_id  text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name      text NOT NULL,
  position  int  NOT NULL DEFAULT 0,
  UNIQUE (topic_id, name)
);

CREATE TABLE topic_prerequisites (
  topic_id        text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  prerequisite_id text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, prerequisite_id),
  CHECK (topic_id <> prerequisite_id)
);

CREATE TABLE worked_examples (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  position    int  NOT NULL DEFAULT 0,
  problem_md  text NOT NULL,
  solution_md text NOT NULL
);

CREATE TABLE formula_cards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id       text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title          text NOT NULL,
  formula_tex    text NOT NULL,
  explanation_md text NOT NULL DEFAULT '',
  derivation_md  text NOT NULL DEFAULT '',
  is_shortcut    boolean NOT NULL DEFAULT false,
  safe_when_md   text NOT NULL DEFAULT '',
  fails_when_md  text NOT NULL DEFAULT '',
  high_value     boolean NOT NULL DEFAULT false,
  UNIQUE (topic_id, title)
);

-- ---------------------------------------------------------------- exam patterns
CREATE TABLE exam_configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year                int  NOT NULL UNIQUE,
  name                text NOT NULL,
  total_duration_min  int  NOT NULL,
  sectional_lock      boolean NOT NULL DEFAULT true,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified', 'unverified')),
  source_note         text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exam_config_sections (
  exam_config_id uuid NOT NULL REFERENCES exam_configs(id) ON DELETE CASCADE,
  section_id     text NOT NULL REFERENCES sections(id),
  position       int  NOT NULL,
  duration_min   int  NOT NULL,
  question_count int  NOT NULL,
  mcq_correct    numeric(4,2) NOT NULL,
  mcq_wrong      numeric(4,2) NOT NULL,   -- stored as a negative number, e.g. -1
  tita_correct   numeric(4,2) NOT NULL,
  tita_wrong     numeric(4,2) NOT NULL,
  PRIMARY KEY (exam_config_id, section_id)
);

-- ---------------------------------------------------------------- content
CREATE TABLE tags (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- Origin of content. Only 'authentic_pyq' may carry exam_year / exam_slot.
CREATE TABLE passages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id       text NOT NULL UNIQUE,
  title             text NOT NULL,
  domain            text NOT NULL,
  difficulty        text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'difficult', 'advanced')),
  body_md           text NOT NULL,
  central_argument  text NOT NULL DEFAULT '',
  structure_md      text NOT NULL DEFAULT '',
  purpose_tone      text NOT NULL DEFAULT '',
  vocabulary_md     text NOT NULL DEFAULT '',
  origin            text NOT NULL CHECK (origin IN ('authentic_pyq', 'reconstructed', 'inspired', 'original_practice', 'ai_generated')),
  exam_year         int,
  exam_slot         int,
  word_count        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dilr_sets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      text NOT NULL UNIQUE,
  title            text NOT NULL,
  set_type         text NOT NULL,
  difficulty       text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'difficult', 'advanced')),
  body_md          text NOT NULL,          -- full set: description, tables (markdown), constraints
  structure_md     text NOT NULL DEFAULT '',  -- how to identify the structure / what to build
  deductions_md    text NOT NULL DEFAULT '',  -- certain deductions in efficient order
  selection_md     text NOT NULL DEFAULT '',  -- is the set worth attempting, recovery
  origin           text NOT NULL CHECK (origin IN ('authentic_pyq', 'reconstructed', 'inspired', 'original_practice', 'ai_generated')),
  exam_year        int,
  exam_slot        int,
  estimated_time_sec int NOT NULL DEFAULT 900,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           text NOT NULL UNIQUE,
  exam_name             text NOT NULL DEFAULT 'CAT',
  section_id            text NOT NULL REFERENCES sections(id),
  topic_id              text NOT NULL REFERENCES topics(id),
  subtopic_id           text REFERENCES subtopics(id),
  passage_id            uuid REFERENCES passages(id) ON DELETE CASCADE,
  dilr_set_id           uuid REFERENCES dilr_sets(id) ON DELETE CASCADE,
  position_in_group     int,
  question_type         text NOT NULL CHECK (question_type IN ('MCQ', 'TITA')),
  difficulty            text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'difficult', 'advanced')),
  stem_md               text NOT NULL,
  correct_answer        text NOT NULL,
  answer_tolerance      numeric NOT NULL DEFAULT 0,
  estimated_time_sec    int  NOT NULL CHECK (estimated_time_sec > 0),
  origin                text NOT NULL CHECK (origin IN ('authentic_pyq', 'reconstructed', 'inspired', 'original_practice', 'ai_generated')),
  exam_year             int,
  exam_slot             int,
  marks_correct         numeric(4,2) NOT NULL DEFAULT 3,
  marks_wrong           numeric(4,2) NOT NULL DEFAULT -1,
  source_verification   text NOT NULL DEFAULT 'unverified' CHECK (source_verification IN ('verified', 'unverified', 'not_applicable')),
  solution_verification text NOT NULL DEFAULT 'unverified' CHECK (solution_verification IN ('verified', 'unverified')),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unpublished')),
  version               int  NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  search                tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(stem_md, ''))) STORED,
  CHECK (passage_id IS NULL OR dilr_set_id IS NULL),
  CHECK (origin = 'authentic_pyq' OR (exam_year IS NULL AND exam_slot IS NULL)),
  CHECK (origin = 'authentic_pyq' OR source_verification = 'not_applicable'),
  CHECK (marks_wrong <= 0)
);
CREATE INDEX questions_filter_idx ON questions(status, section_id, topic_id, difficulty);
CREATE INDEX questions_origin_idx ON questions(origin, exam_year, exam_slot);
CREATE INDEX questions_passage_idx ON questions(passage_id) WHERE passage_id IS NOT NULL;
CREATE INDEX questions_set_idx ON questions(dilr_set_id) WHERE dilr_set_id IS NOT NULL;
CREATE INDEX questions_search_idx ON questions USING gin(search);

CREATE TABLE question_options (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[A-F]$'),
  text_md     text NOT NULL,
  PRIMARY KEY (question_id, key)
);

CREATE TABLE question_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source_name   text NOT NULL,
  reference     text NOT NULL DEFAULT '',
  url           text,
  license_note  text NOT NULL DEFAULT '',
  verified_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_sources_q_idx ON question_sources(question_id);

CREATE TABLE question_solutions (
  question_id        uuid PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  concepts_tested    text NOT NULL DEFAULT '',
  prerequisites      text NOT NULL DEFAULT '',
  learn_md           text NOT NULL,              -- detailed step-by-step
  exam_method_md     text NOT NULL DEFAULT '',   -- efficient approach
  hints              text[] NOT NULL DEFAULT '{}',
  verification_md    text NOT NULL DEFAULT '',   -- final answer check
  common_mistakes_md text NOT NULL DEFAULT '',
  distractors        jsonb NOT NULL DEFAULT '{}'::jsonb, -- option key -> why it is wrong
  alternative_md     text NOT NULL DEFAULT '',
  advanced_md        text NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE question_tags (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id      int  NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE question_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version     int  NOT NULL,
  snapshot    jsonb NOT NULL,
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, version)
);

-- ---------------------------------------------------------------- learner activity
CREATE TABLE question_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id         uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  context             text NOT NULL DEFAULT 'practice' CHECK (context IN ('practice', 'lesson', 'diagnostic', 'revision', 'drill', 'error_test', 'mock')),
  context_id          text,
  answer              text,
  is_correct          boolean NOT NULL,
  time_taken_sec      int NOT NULL CHECK (time_taken_sec >= 0),
  timed               boolean NOT NULL DEFAULT false,
  confidence          smallint CHECK (confidence BETWEEN 1 AND 3),
  guessed             boolean NOT NULL DEFAULT false,
  understood          boolean,
  mistake_type        text,
  hints_used          int NOT NULL DEFAULT 0,
  solution_seen_first boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_user_q_idx ON question_attempts(user_id, question_id, created_at DESC);
CREATE INDEX attempts_user_time_idx ON question_attempts(user_id, created_at DESC);

CREATE TABLE user_topic_mastery (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id         text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  score            numeric(5,2) NOT NULL DEFAULT 0,
  state            text NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started', 'learning', 'practicing', 'weak', 'revision_due', 'proficient', 'exam_ready')),
  mode             text NOT NULL DEFAULT 'A' CHECK (mode IN ('A', 'B')),
  attempts_count   int NOT NULL DEFAULT 0,
  correct_count    int NOT NULL DEFAULT 0,
  distinct_questions int NOT NULL DEFAULT 0,
  last_practiced_at timestamptz,
  state_reason     text NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

CREATE TABLE bookmarks (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE user_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE,
  topic_id    text REFERENCES topics(id) ON DELETE CASCADE,
  passage_id  uuid REFERENCES passages(id) ON DELETE CASCADE,
  dilr_set_id uuid REFERENCES dilr_sets(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'annotation', 'highlight', 'workspace')),
  body        text NOT NULL,
  anchor      jsonb,   -- highlight offsets / workspace grid; shape validated in the API
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_idx ON user_notes(user_id, updated_at DESC);

CREATE TABLE error_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id        uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  attempt_id         uuid REFERENCES question_attempts(id) ON DELETE SET NULL,
  learner_answer     text,
  correct_answer     text NOT NULL,
  category           text NOT NULL CHECK (category IN ('conceptual_gap', 'formula_recall', 'calculation_error', 'misread_question', 'incorrect_assumption', 'logical_reasoning_error', 'poor_option_elimination', 'time_pressure', 'blind_guess', 'wrong_question_selection', 'overcomplication', 'careless_execution', 'unclassified')),
  root_cause         text NOT NULL DEFAULT '',
  correct_approach   text NOT NULL DEFAULT '',
  remediation_topic_id text REFERENCES topics(id),
  next_review_at     timestamptz NOT NULL DEFAULT now(),
  review_count       int NOT NULL DEFAULT 0,
  last_review_correct boolean,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_logs_user_idx ON error_logs(user_id, created_at DESC);
CREATE UNIQUE INDEX error_logs_open_unique ON error_logs(user_id, question_id) WHERE resolved_at IS NULL;

CREATE TABLE revision_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type        text NOT NULL CHECK (item_type IN ('question', 'formula', 'error', 'topic')),
  ref_id           text NOT NULL,
  topic_id         text REFERENCES topics(id) ON DELETE CASCADE,
  reason           text NOT NULL DEFAULT '',
  interval_days    numeric(6,2) NOT NULL DEFAULT 1,
  ease             numeric(4,2) NOT NULL DEFAULT 2.3,
  reps             int NOT NULL DEFAULT 0,
  lapses           int NOT NULL DEFAULT 0,
  due_at           timestamptz NOT NULL,
  last_reviewed_at timestamptz,
  retired          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_type, ref_id)
);
CREATE INDEX revision_due_idx ON revision_items(user_id, due_at) WHERE NOT retired;

CREATE TABLE revision_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_item_id uuid NOT NULL REFERENCES revision_items(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade            smallint NOT NULL CHECK (grade BETWEEN 0 AND 3),  -- 0 forgot, 1 hard, 2 good, 3 easy
  interval_before  numeric(6,2) NOT NULL,
  interval_after   numeric(6,2) NOT NULL,
  reviewed_at      timestamptz NOT NULL DEFAULT now()
);

-- Daily lessons are generated per learner. The plan column is the generated lesson
-- document (ordered blocks referencing question ids); progress is relational.
CREATE TABLE lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_date   date NOT NULL,
  topic_id      text NOT NULL REFERENCES topics(id),
  minutes       int NOT NULL,
  rationale     text NOT NULL DEFAULT '',
  plan          jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  report        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  UNIQUE (user_id, lesson_date, minutes)
);

CREATE TABLE lesson_progress (
  lesson_id    uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  block_key    text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, block_key)
);

CREATE TABLE study_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  rationale   text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX study_plans_one_active ON study_plans(user_id) WHERE status = 'active';

CREATE TABLE study_plan_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  original_date  date NOT NULL,
  task_type      text NOT NULL CHECK (task_type IN ('learn', 'practice', 'revision', 'mock', 'mock_review', 'catch_up')),
  topic_id       text REFERENCES topics(id),
  title          text NOT NULL,
  minutes        int NOT NULL CHECK (minutes > 0),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  position       int NOT NULL DEFAULT 0,
  completed_at   timestamptz
);
CREATE INDEX plan_tasks_user_date_idx ON study_plan_tasks(user_id, scheduled_date);

CREATE TABLE study_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  ref_id     text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  active_seconds int NOT NULL DEFAULT 0
);
CREATE INDEX study_sessions_user_idx ON study_sessions(user_id, started_at DESC);

-- ---------------------------------------------------------------- mocks
CREATE TABLE mock_tests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid REFERENCES users(id) ON DELETE CASCADE,  -- NULL = platform test available to all
  title          text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('full', 'sectional', 'topic', 'custom', 'pyq_paper', 'diagnostic', 'drill', 'error_test')),
  exam_config_id uuid REFERENCES exam_configs(id),
  sectional_lock boolean NOT NULL DEFAULT true,
  description    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mock_test_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_test_id uuid NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  section_id   text NOT NULL REFERENCES sections(id),
  position     int  NOT NULL,
  duration_sec int  NOT NULL CHECK (duration_sec > 0),
  UNIQUE (mock_test_id, position)
);

CREATE TABLE mock_test_questions (
  mock_test_section_id uuid NOT NULL REFERENCES mock_test_sections(id) ON DELETE CASCADE,
  question_id          uuid NOT NULL REFERENCES questions(id),
  position             int  NOT NULL,
  marks_correct        numeric(4,2) NOT NULL,
  marks_wrong          numeric(4,2) NOT NULL,
  PRIMARY KEY (mock_test_section_id, question_id)
);

CREATE TABLE mock_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_test_id        uuid NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  current_section     int NOT NULL DEFAULT 0,
  section_started_at  timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  submit_reason       text CHECK (submit_reason IN ('manual', 'timeout')),
  raw_score           numeric(7,2)
);
CREATE INDEX mock_attempts_user_idx ON mock_attempts(user_id, started_at DESC);
CREATE UNIQUE INDEX mock_attempts_one_open ON mock_attempts(user_id, mock_test_id) WHERE status = 'in_progress';

CREATE TABLE mock_responses (
  attempt_id     uuid NOT NULL REFERENCES mock_attempts(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES questions(id),
  answer         text,
  flagged        boolean NOT NULL DEFAULT false,
  visited        boolean NOT NULL DEFAULT true,
  time_spent_sec int NOT NULL DEFAULT 0 CHECK (time_spent_sec >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE mock_analysis (
  attempt_id   uuid PRIMARY KEY REFERENCES mock_attempts(id) ON DELETE CASCADE,
  summary      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- AI tutor
CREATE TABLE generated_practice_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id          text REFERENCES topics(id),
  based_on_question uuid REFERENCES questions(id) ON DELETE SET NULL,
  stem_md           text NOT NULL,
  options           jsonb,
  answer            text NOT NULL,
  solution_md       text NOT NULL DEFAULT '',
  validation_status text NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN ('validated', 'unvalidated', 'failed')),
  validation_note   text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_tutor_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type text NOT NULL DEFAULT 'general' CHECK (context_type IN ('general', 'topic', 'question', 'mock', 'error')),
  context_id   text,
  title        text NOT NULL DEFAULT 'Tutor session',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_tutor_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES ai_tutor_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  provider    text,
  grounding   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tutor_messages_session_idx ON ai_tutor_messages(session_id, created_at);

-- ---------------------------------------------------------------- admin
CREATE TABLE content_import_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  filename    text NOT NULL DEFAULT '',
  status      text NOT NULL CHECK (status IN ('validated', 'imported', 'failed')),
  dry_run     boolean NOT NULL DEFAULT false,
  total       int NOT NULL DEFAULT 0,
  accepted    int NOT NULL DEFAULT 0,
  rejected    int NOT NULL DEFAULT 0,
  report      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);
