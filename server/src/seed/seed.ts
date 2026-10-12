import { many, one, query, tx } from '../db/pool.js';
import { runImport } from '../modules/admin/importer.js';
import { FORMULAS } from './content/formulas.js';
import { SAMPLE_QA } from './content/sample-qa.js';
import { SAMPLE_VARC_DILR } from './content/sample-varc-dilr.js';
import { MASTERY_CRITERIA, SYLLABUS } from './content/syllabus.js';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Syllabus, formulas and exam pattern. Idempotent. */
export async function seedReference() {
  await tx(async (c) => {
    for (const s of SYLLABUS) {
      await query('INSERT INTO sections(id, name, position) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, position=EXCLUDED.position', [s.id, s.name, s.position], c);
      for (const [i, t] of s.topics.entries()) {
        const complete = !!(t.concept && t.concept.length > 120);
        await query(
          `INSERT INTO topics(id, section_id, area, name, position, summary, concept_md, traps_md, revision_md, mastery_criteria, content_status, estimated_hours)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET area=EXCLUDED.area, name=EXCLUDED.name, position=EXCLUDED.position, summary=EXCLUDED.summary, concept_md=EXCLUDED.concept_md,
             traps_md=EXCLUDED.traps_md, revision_md=EXCLUDED.revision_md, mastery_criteria=EXCLUDED.mastery_criteria, content_status=EXCLUDED.content_status,
             estimated_hours=EXCLUDED.estimated_hours`,
          [t.id, s.id, t.area, t.name, i + 1, t.summary, t.concept ?? '', t.traps ?? '', t.revision ?? '', MASTERY_CRITERIA, complete ? 'complete' : 'outline', t.hours ?? 2],
          c,
        );
        for (const [j, st] of (t.subtopics ?? []).entries()) {
          await query('INSERT INTO subtopics(id, topic_id, name, position) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [`${t.id}--${slug(st)}`, t.id, st, j + 1], c);
        }
      }
    }
    for (const s of SYLLABUS) {
      for (const t of s.topics) {
        for (const p of t.prereqs ?? []) {
          await query('INSERT INTO topic_prerequisites(topic_id, prerequisite_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [t.id, p], c);
        }
      }
    }
    for (const f of FORMULAS) {
      await query(
        `INSERT INTO formula_cards(topic_id, title, formula_tex, explanation_md, derivation_md, is_shortcut, safe_when_md, fails_when_md, high_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (topic_id, title) DO UPDATE SET formula_tex=EXCLUDED.formula_tex, explanation_md=EXCLUDED.explanation_md, derivation_md=EXCLUDED.derivation_md,
           is_shortcut=EXCLUDED.is_shortcut, safe_when_md=EXCLUDED.safe_when_md, fails_when_md=EXCLUDED.fails_when_md, high_value=EXCLUDED.high_value`,
        [f.topic, f.title, f.tex, f.explanation, f.derivation ?? '', !!f.shortcut, f.safeWhen ?? '', f.failsWhen ?? '', !!f.highValue],
        c,
      );
    }
    // Exam pattern. Marked UNVERIFIED: an admin must confirm it against the official
    // IIM notification for the year before it is treated as authoritative.
    const cfg = await one(
      `INSERT INTO exam_configs(year, name, total_duration_min, sectional_lock, verification_status, source_note)
       VALUES (2024, 'CAT 2024 pattern', 120, true, 'unverified',
         'Commonly reported CAT 2024 structure: three sections in fixed order (VARC, DILR, QA), 40 minutes each, 68 questions; +3 for a correct answer, −1 for a wrong MCQ, 0 for a wrong TITA. Verify against the official CAT notification before relying on it.')
       ON CONFLICT (year) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [],
      c,
    );
    const rows: [string, number, number][] = [
      ['VARC', 1, 24],
      ['DILR', 2, 22],
      ['QA', 3, 22],
    ];
    for (const [sec, pos, count] of rows) {
      await query(
        `INSERT INTO exam_config_sections(exam_config_id, section_id, position, duration_min, question_count, mcq_correct, mcq_wrong, tita_correct, tita_wrong)
         VALUES ($1,$2,$3,40,$4,3,-1,3,0) ON CONFLICT (exam_config_id, section_id) DO NOTHING`,
        [cfg!.id, sec, pos, count],
        c,
      );
    }
  });
}

/** Clearly labelled original practice content (not PYQs). */
export async function seedSamples() {
  const items = [...SAMPLE_QA, ...SAMPLE_VARC_DILR].map((it) => (it.kind === 'question' ? { ...it, solutionVerified: true } : it));
  const job = await runImport(items, { actorId: null, publish: true, filename: 'cat100-original-practice-samples' });
  if (job.status !== 'imported') throw new Error(`Sample import failed: ${JSON.stringify(job.report)}`);
  const errors = (job.report as any[]).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(`Sample import rejected items: ${JSON.stringify(errors)}`);
  return job;
}

/** Platform-level sample test in the configured exam format, using whatever published questions exist. */
export async function seedSampleMocks() {
  const exists = await one("SELECT id FROM mock_tests WHERE owner_id IS NULL AND title = 'Sample test in CAT format'");
  if (exists) return;
  const cfg = await one('SELECT id FROM exam_configs ORDER BY year DESC LIMIT 1');
  const sections = await many('SELECT section_id, position, duration_min FROM exam_config_sections WHERE exam_config_id = $1 ORDER BY position', [cfg!.id]);
  await tx(async (c) => {
    const m = await one(
      `INSERT INTO mock_tests(owner_id, title, kind, exam_config_id, sectional_lock, description) VALUES (NULL, 'Sample test in CAT format', 'full', $1, true,
        'Uses the configured CAT section order, timing and marking with the small set of original sample questions. It is not a full-length 68-question mock.') RETURNING id`,
      [cfg!.id],
      c,
    );
    for (const s of sections) {
      const sec = await one('INSERT INTO mock_test_sections(mock_test_id, section_id, position, duration_sec) VALUES ($1,$2,$3,$4) RETURNING id', [m!.id, s.section_id, s.position, s.duration_min * 60], c);
      const qs = await many(
        `SELECT id, question_type, marks_correct, marks_wrong FROM questions WHERE status = 'published' AND section_id = $1
         ORDER BY passage_id NULLS LAST, dilr_set_id NULLS LAST, position_in_group NULLS LAST, external_id`,
        [s.section_id],
        c,
      );
      for (const [i, q] of qs.entries()) {
        await query('INSERT INTO mock_test_questions(mock_test_section_id, question_id, position, marks_correct, marks_wrong) VALUES ($1,$2,$3,$4,$5)', [sec!.id, q.id, i + 1, q.marks_correct, q.marks_wrong], c);
      }
    }
  });
}

export async function seedAll() {
  await seedReference();
  await seedSamples();
  await seedSampleMocks();
}
