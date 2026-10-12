-- Tracks explicit "show solution" actions before answering, so a later correct
-- attempt on the same question is not counted as independent evidence of mastery.
CREATE TABLE solution_reveals (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  revealed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

-- Strategy drills: learner picks which questions to attempt under a time budget.
CREATE TABLE strategy_drills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id    text NOT NULL REFERENCES sections(id),
  budget_sec    int  NOT NULL CHECK (budget_sec > 0),
  question_ids  uuid[] NOT NULL,
  chosen_ids    uuid[],
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz
);
CREATE INDEX strategy_drills_user_idx ON strategy_drills(user_id, created_at DESC);
