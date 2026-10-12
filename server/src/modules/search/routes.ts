import { Router } from 'express';
import { z } from 'zod';
import { many } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { parseQuery } from '../../lib/validate.js';

export const searchRouter = Router();

/** Global search across questions, topics, lessons, solutions, formulas, notes, bookmarks, errors and tests. */
searchRouter.get('/', async (req, res) => {
  const uid = userId(req);
  const { q } = parseQuery(z.object({ q: z.string().trim().min(2).max(200) }), req);
  const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const [questions, topics, solutions, formulas, notes, bookmarks, errors, mocks, lessons] = await Promise.all([
    many(
      `SELECT id, external_id, section_id, left(stem_md, 160) AS preview FROM questions
        WHERE status = 'published' AND (search @@ plainto_tsquery('english', $1) OR stem_md ILIKE $2 OR external_id ILIKE $2) LIMIT 10`,
      [q, like],
    ),
    many('SELECT id, name, section_id, summary FROM topics WHERE name ILIKE $1 OR summary ILIKE $1 OR concept_md ILIKE $1 LIMIT 10', [like]),
    many(
      `SELECT q.id, q.external_id, left(s.learn_md, 160) AS preview FROM question_solutions s JOIN questions q ON q.id = s.question_id
        WHERE q.status = 'published' AND (s.learn_md ILIKE $1 OR s.exam_method_md ILIKE $1)
          AND (EXISTS (SELECT 1 FROM question_attempts a WHERE a.user_id = $2 AND a.question_id = q.id) OR EXISTS (SELECT 1 FROM solution_reveals r WHERE r.user_id = $2 AND r.question_id = q.id))
        LIMIT 10`,
      [like, uid],
    ),
    many('SELECT f.id, f.title, f.topic_id, t.name AS topic_name FROM formula_cards f JOIN topics t ON t.id = f.topic_id WHERE f.title ILIKE $1 OR f.explanation_md ILIKE $1 LIMIT 10', [like]),
    many('SELECT id, left(body, 160) AS preview, question_id, topic_id, passage_id, dilr_set_id FROM user_notes WHERE user_id = $1 AND body ILIKE $2 LIMIT 10', [uid, like]),
    many(
      `SELECT q.id, q.external_id, left(q.stem_md, 160) AS preview FROM bookmarks b JOIN questions q ON q.id = b.question_id
        WHERE b.user_id = $1 AND (q.stem_md ILIKE $2 OR q.external_id ILIKE $2) LIMIT 10`,
      [uid, like],
    ),
    many(
      `SELECT e.id, q.id AS question_id, q.external_id, e.category FROM error_logs e JOIN questions q ON q.id = e.question_id
        WHERE e.user_id = $1 AND (q.stem_md ILIKE $2 OR e.root_cause ILIKE $2 OR e.category ILIKE $2) LIMIT 10`,
      [uid, like],
    ),
    many('SELECT id, title, kind FROM mock_tests WHERE (owner_id IS NULL OR owner_id = $1) AND title ILIKE $2 LIMIT 10', [uid, like]),
    many('SELECT l.id, l.lesson_date, t.name AS topic_name FROM lessons l JOIN topics t ON t.id = l.topic_id WHERE l.user_id = $1 AND t.name ILIKE $2 LIMIT 10', [uid, like]),
  ]);
  res.json({ questions, topics, solutions, formulas, notes, bookmarks, errors, mocks, lessons });
});
