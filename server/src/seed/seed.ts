import type pg from 'pg';
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
    await ensureCat2024Pattern(c);
  });
}

/**
 * What was checked about the CAT 2024 pattern while building CAT 100 (2026-10-12). The official
 * Information Bulletin could not be opened from the build environment, so no simulator setting
 * is verified. An admin verifies settings in Content admin → Exam pattern once they have read
 * the bulletin.
 */
export const CAT_2024_SOURCES = [
  {
    kind: 'official' as const,
    title: 'CAT 2024 advertisement',
    publisher: 'Indian Institute of Management Lucknow (iiml.ac.in)',
    url: 'https://iiml.ac.in/hi/sites/default/files/upload/news/CAT_2024_Advertisement.pdf',
    accessedOn: '2026-10-12',
    supports:
      'States that CAT 2024 is a computer-based test on November 24, 2024 in three sessions, with registration from August 1 to September 13, 2024. ' +
      'It does not state sections, timing, question counts or marking, so it verifies none of the simulator settings.',
    note: 'The CAT 2024 Information Bulletin on iimcat.ac.in could not be reached from the build environment.',
  },
  {
    kind: 'secondary' as const,
    title: 'Common Admission Test',
    publisher: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Common_Admission_Test',
    accessedOn: '2026-10-12',
    supports:
      'Describes CAT 2024 as three 40-minute parts, 120 minutes in total (citing Shiksha); gives 68 questions split 24 VARC, 22 DILR and 22 QA for CAT 2025 (citing IMS); ' +
      'and gives +3 for a correct answer, −1 for a wrong MCQ and no negative marking for TITA (citing learningroutes.in). Secondary and partly uncited, so it cannot verify anything.',
    note: '',
  },
];

/** Creates the CAT 2024 pattern as version 1 if it is missing and attaches the sources above. Never overwrites a stored pattern. */
export async function ensureCat2024Pattern(c: pg.PoolClient) {
  let cfg = await one('SELECT id FROM exam_configs WHERE year = 2024 ORDER BY version LIMIT 1', [], c);
  if (!cfg) {
    const hasActive = await one('SELECT 1 FROM exam_configs WHERE is_active', [], c);
    cfg = await one(
      `INSERT INTO exam_configs(year, version, name, total_duration_min, sectional_lock, verification_status, source_note, is_active)
       VALUES (2024, 1, 'CAT 2024 pattern', 120, true, 'unverified',
         'Structure as commonly reported for CAT 2024: three sections in fixed order (VARC, DILR, QA), 40 minutes each, 68 questions; +3 for a correct answer, −1 for a wrong MCQ, 0 for a wrong TITA, 0 when unanswered. Not yet checked against the official CAT 2024 Information Bulletin.',
         $1) RETURNING id`,
      [!hasActive],
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
         VALUES ($1,$2,$3,40,$4,3,-1,3,0)`,
        [cfg!.id, sec, pos, count],
        c,
      );
    }
  }
  for (const src of CAT_2024_SOURCES) {
    const exists = await one('SELECT 1 FROM exam_config_sources WHERE exam_config_id = $1 AND url = $2', [cfg!.id, src.url], c);
    if (!exists) {
      await query(
        'INSERT INTO exam_config_sources(exam_config_id, kind, title, publisher, url, accessed_on, supports, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [cfg!.id, src.kind, src.title, src.publisher, src.url, src.accessedOn, src.supports, src.note],
        c,
      );
    }
  }
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
  const cfg = await one('SELECT id FROM exam_configs WHERE is_active');
  const sections = await many('SELECT * FROM exam_config_sections WHERE exam_config_id = $1 ORDER BY position', [cfg!.id]);
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
        `SELECT id, question_type FROM questions WHERE status = 'published' AND section_id = $1
         ORDER BY passage_id NULLS LAST, dilr_set_id NULLS LAST, position_in_group NULLS LAST, external_id`,
        [s.section_id],
        c,
      );
      for (const [i, q] of qs.entries()) {
        // Marking comes from the exam pattern the test was built with.
        const mc = q.question_type === 'MCQ' ? s.mcq_correct : s.tita_correct;
        const mw = q.question_type === 'MCQ' ? s.mcq_wrong : s.tita_wrong;
        await query('INSERT INTO mock_test_questions(mock_test_section_id, question_id, position, marks_correct, marks_wrong) VALUES ($1,$2,$3,$4,$5)', [sec!.id, q.id, i + 1, mc, mw], c);
      }
    }
  });
}

export async function seedAll() {
  await seedReference();
  await seedSamples();
  await seedSampleMocks();
}
