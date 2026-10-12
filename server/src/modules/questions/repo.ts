import { many, one } from '../../db/pool.js';
import { PROVENANCE_SQL } from '../../domain/provenance.js';

/** Public view of a question: never includes the answer or solution. */
export async function loadQuestionPublic(id: string, userId: string) {
  const q = await one(
    `SELECT q.id, q.external_id, q.exam_name, q.section_id, q.topic_id, t.name AS topic_name, q.subtopic_id, q.passage_id, q.dilr_set_id, q.position_in_group,
            q.question_type, q.difficulty, q.stem_md, q.estimated_time_sec, q.origin, q.exam_year, q.exam_slot, q.marks_correct, q.marks_wrong,
            q.source_verification, q.solution_verification, q.answer_key_verification, q.question_number, q.version,
            ${PROVENANCE_SQL} AS provenance,
            EXISTS (SELECT 1 FROM bookmarks b WHERE b.user_id = $2 AND b.question_id = q.id) AS bookmarked,
            (SELECT count(*) FROM question_attempts a WHERE a.user_id = $2 AND a.question_id = q.id) AS attempt_count,
            (SELECT a.is_correct FROM question_attempts a WHERE a.user_id = $2 AND a.question_id = q.id ORDER BY a.created_at DESC LIMIT 1) AS last_correct,
            EXISTS (SELECT 1 FROM solution_reveals r WHERE r.user_id = $2 AND r.question_id = q.id) AS revealed
       FROM questions q JOIN topics t ON t.id = q.topic_id
      WHERE q.id = $1 AND q.status = 'published'`,
    [id, userId],
  );
  if (!q) return null;
  const options = await many('SELECT key, text_md FROM question_options WHERE question_id = $1 ORDER BY key', [id]);
  const sources = await many(
    "SELECT source_name, reference, url, license_note, kind, verified_at IS NOT NULL AS verified FROM question_sources WHERE question_id = $1 AND kind <> 'answer_key' ORDER BY created_at",
    [id],
  );
  const tags = await many('SELECT t.name FROM question_tags qt JOIN tags t ON t.id = qt.tag_id WHERE qt.question_id = $1', [id]);
  let group: any = null;
  if (q.passage_id) {
    const p = await one('SELECT id, external_id, title, domain, difficulty, body_md, word_count, origin, exam_year, exam_slot FROM passages WHERE id = $1', [q.passage_id]);
    const siblings = await many("SELECT id, position_in_group FROM questions WHERE passage_id = $1 AND status = 'published' ORDER BY position_in_group, external_id", [q.passage_id]);
    group = { kind: 'passage', ...p, questionIds: siblings.map((s) => s.id) };
  } else if (q.dilr_set_id) {
    const s = await one('SELECT id, external_id, title, set_type, difficulty, body_md, origin, exam_year, exam_slot, estimated_time_sec FROM dilr_sets WHERE id = $1', [q.dilr_set_id]);
    const siblings = await many("SELECT id FROM questions WHERE dilr_set_id = $1 AND status = 'published' ORDER BY position_in_group, external_id", [q.dilr_set_id]);
    group = { kind: 'dilr_set', ...s, questionIds: siblings.map((x) => x.id) };
  }
  return { ...q, options, sources, tags: tags.map((t) => t.name), group };
}

export async function loadSolution(id: string) {
  const q = await one('SELECT id, correct_answer, question_type, difficulty, estimated_time_sec, topic_id, solution_verification FROM questions WHERE id = $1', [id]);
  if (!q) return null;
  const s = await one('SELECT * FROM question_solutions WHERE question_id = $1', [id]);
  const related = await many(
    `SELECT id, external_id, difficulty, left(stem_md, 140) AS stem_preview FROM questions
      WHERE topic_id = $1 AND id <> $2 AND status = 'published' ORDER BY random() LIMIT 3`,
    [q.topic_id, id],
  );
  const prereqs = await many(
    'SELECT t.id, t.name FROM topic_prerequisites p JOIN topics t ON t.id = p.prerequisite_id WHERE p.topic_id = $1',
    [q.topic_id],
  );
  return { ...q, solution: s, related, prerequisiteTopics: prereqs };
}
