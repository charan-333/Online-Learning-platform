import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { userId } from '../../lib/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { pagination, parseBody, parseQuery, uuidParam } from '../../lib/validate.js';
import { getEmailProvider, emailStatus, sendMail } from '../../lib/mailer.js';
import { activate, addSource, createConfigVersion, listConfigs, loadConfig, PATTERN_FIELD_KEYS, removeSource, setFieldStatus, updateDraft } from '../../services/examConfigs.js';
import { CSV_COLUMNS, parseImportFile } from './importFormats.js';
import { runImport, snapshotQuestion } from './importer.js';
import { DIFFICULTIES } from './importSchema.js';
import { approveGroup, approveQuestion, questionChecks, rejectQuestions, reviewQueue } from './review.js';

export const adminRouter = Router();
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');

adminRouter.post('/questions/import', async (req, res) => {
  const b = parseBody(
    z.object({ items: z.array(z.unknown()).min(1).max(2000), dryRun: z.boolean().default(false), publish: z.boolean().default(false), filename: z.string().max(200).default('') }),
    req,
  );
  const job = await runImport(b.items, { actorId: userId(req), dryRun: b.dryRun, publish: b.publish, filename: b.filename });
  res.status(b.dryRun ? 200 : 201).json(job);
});

/** Imports a file in JSON, JSON Lines or CSV. The file's SHA-256 is kept with the job for provenance. */
adminRouter.post('/questions/import-file', async (req, res) => {
  const b = parseBody(
    z.object({
      format: z.enum(['json', 'jsonl', 'csv']),
      content: z.string().min(1).max(4_500_000),
      filename: z.string().max(200).default(''),
      dryRun: z.boolean().default(false),
      publish: z.boolean().default(false),
    }),
    req,
  );
  const parsed = parseImportFile(b.format, b.content);
  if (!parsed.items.length) {
    res.status(400).json({ error: { code: 'bad_request', message: parsed.issues[0]?.message ?? 'The file has no items' }, report: parsed.issues });
    return;
  }
  if (parsed.items.length > 2000) throw badRequest('Import at most 2000 items per file');
  const job = await runImport(parsed.items, {
    actorId: userId(req),
    dryRun: b.dryRun,
    publish: b.publish,
    filename: b.filename,
    format: b.format,
    fileSha256: crypto.createHash('sha256').update(b.content).digest('hex'),
    lines: parsed.lines,
    parseIssues: parsed.issues,
  });
  res.status(b.dryRun ? 200 : 201).json(job);
});

/** Header-only CSV with every column the importer understands. */
adminRouter.get('/import-template.csv', (_req, res) => {
  res.type('text/csv').attachment('cat100-import-template.csv').send(`${CSV_COLUMNS.join(',')}\r\n`);
});

adminRouter.get('/import-jobs', async (_req, res) => {
  res.json({ items: await many('SELECT id, filename, status, dry_run, total, accepted, rejected, created_at FROM content_import_jobs ORDER BY created_at DESC LIMIT 50') });
});

adminRouter.get('/import-jobs/:id', async (req, res) => {
  const job = await one('SELECT * FROM content_import_jobs WHERE id = $1', [uuidParam(req)]);
  if (!job) throw notFound('Import job');
  res.json(job);
});

adminRouter.get('/questions', async (req, res) => {
  const f = parseQuery(
    pagination.extend({
      status: z.enum(['draft', 'published', 'unpublished']).optional(),
      origin: z.string().max(40).optional(),
      sourceVerification: z.enum(['verified', 'unverified', 'not_applicable']).optional(),
      solutionVerification: z.enum(['verified', 'unverified']).optional(),
      reviewStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']).optional(),
      q: z.string().max(200).optional(),
    }),
    req,
  );
  const rows = await many(
    `SELECT q.id, q.external_id, q.section_id, q.topic_id, q.question_type, q.difficulty, q.origin, q.exam_year, q.exam_slot, q.status,
            q.source_verification, q.solution_verification, q.answer_key_verification, q.review_status, q.question_number,
            q.version, q.updated_at, left(q.stem_md, 140) AS stem_preview,
            NOT EXISTS (SELECT 1 FROM question_solutions s WHERE s.question_id = q.id) AS missing_solution, count(*) OVER () AS total
       FROM questions q
      WHERE ($1::text IS NULL OR q.status = $1) AND ($2::text IS NULL OR q.origin = $2) AND ($3::text IS NULL OR q.source_verification = $3)
        AND ($4::text IS NULL OR q.solution_verification = $4) AND ($5::text IS NULL OR q.stem_md ILIKE '%' || $5 || '%' OR q.external_id ILIKE '%' || $5 || '%')
        AND ($8::text IS NULL OR q.review_status = $8)
      ORDER BY q.updated_at DESC LIMIT $6 OFFSET $7`,
    [f.status ?? null, f.origin ?? null, f.sourceVerification ?? null, f.solutionVerification ?? null, f.q ?? null, f.pageSize, (f.page - 1) * f.pageSize, f.reviewStatus ?? null],
  );
  res.json({ items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize });
});

adminRouter.get('/questions/:id', async (req, res) => {
  const id = uuidParam(req);
  const q = await one('SELECT * FROM questions WHERE id = $1', [id]);
  if (!q) throw notFound('Question');
  delete q.search;
  const [options, solution, sources, versions] = await Promise.all([
    many('SELECT key, text_md FROM question_options WHERE question_id = $1 ORDER BY key', [id]),
    one('SELECT * FROM question_solutions WHERE question_id = $1', [id]),
    many('SELECT * FROM question_sources WHERE question_id = $1', [id]),
    many('SELECT id, version, changed_by, created_at FROM question_versions WHERE question_id = $1 ORDER BY version DESC', [id]),
  ]);
  const auditRows = await many("SELECT * FROM audit_logs WHERE entity_type = 'question' AND entity_id = $1 ORDER BY created_at DESC LIMIT 50", [id]);
  const checks = q.origin === 'authentic_pyq' ? await questionChecks(id) : null;
  res.json({ ...q, options, solution, sources, versions, audit: auditRows, checks });
});

const patchBody = z
  .object({
    topicId: z.string().max(100),
    subtopicId: z.string().max(140).nullable(),
    difficulty: z.enum(DIFFICULTIES),
    stem: z.string().min(1),
    options: z.record(z.string().min(1)),
    answer: z.string().min(1).max(50),
    tolerance: z.number().min(0),
    estimatedTimeSec: z.number().int().positive(),
    examYear: z.number().int().nullable(),
    examSlot: z.number().int().min(1).max(3).nullable(),
    questionNumber: z.number().int().positive().nullable(),
    marksCorrect: z.number(),
    marksWrong: z.number().max(0),
    solution: z
      .object({
        learn: z.string().min(1),
        examMethod: z.string(),
        hints: z.array(z.string()),
        verification: z.string(),
        commonMistakes: z.string(),
        distractors: z.record(z.string()),
        conceptsTested: z.string(),
        prerequisites: z.string(),
        alternative: z.string(),
        advanced: z.string(),
      })
      .partial(),
  })
  .partial();

/** Edits a question. Every edit snapshots the previous version and resets solution verification if the answer or solution changed. */
adminRouter.patch('/questions/:id', async (req, res) => {
  const id = uuidParam(req);
  const actor = userId(req);
  const b = parseBody(patchBody, req);
  const q = await one('SELECT * FROM questions WHERE id = $1', [id]);
  if (!q) throw notFound('Question');
  if (!['authentic_pyq', 'reconstructed'].includes(q.origin) && (b.examYear || b.examSlot || b.questionNumber)) {
    throw badRequest('Only authentic PYQs and memory-based reconstructions can carry an exam year, slot or question number');
  }
  const newOptions = b.options ?? null;
  const answer = b.answer ?? q.correct_answer;
  if (q.question_type === 'MCQ') {
    const keys = newOptions ? Object.keys(newOptions) : (await many('SELECT key FROM question_options WHERE question_id = $1', [id])).map((r) => r.key);
    if (!keys.includes(answer)) throw badRequest('Answer must be one of the option keys');
  } else if (newOptions && Object.keys(newOptions).length) throw badRequest('TITA questions cannot have options');
  const changedAnswerOrSolution = b.answer !== undefined || b.solution !== undefined || b.options !== undefined || b.stem !== undefined;
  // Any change to what a PYQ says, its answer or where it comes from sends it back to review,
  // and takes it out of learners' view until an admin approves it again.
  const pyqNeedsReview =
    q.origin === 'authentic_pyq' && (changedAnswerOrSolution || b.examYear !== undefined || b.examSlot !== undefined || b.questionNumber !== undefined);
  await tx(async (c) => {
    await snapshotQuestion(c, id, actor);
    await query(
      `UPDATE questions SET topic_id = coalesce($2, topic_id), subtopic_id = CASE WHEN $3 THEN $4 ELSE subtopic_id END, difficulty = coalesce($5, difficulty),
         stem_md = coalesce($6, stem_md), correct_answer = $7, answer_tolerance = coalesce($8, answer_tolerance), estimated_time_sec = coalesce($9, estimated_time_sec),
         exam_year = CASE WHEN $10 THEN $11 ELSE exam_year END, exam_slot = CASE WHEN $12 THEN $13 ELSE exam_slot END,
         marks_correct = coalesce($14, marks_correct), marks_wrong = coalesce($15, marks_wrong),
         solution_verification = CASE WHEN $16 THEN 'unverified' ELSE solution_verification END,
         question_number = CASE WHEN $17 THEN $18 ELSE question_number END,
         review_status = CASE WHEN $19 THEN 'pending' ELSE review_status END,
         source_verification = CASE WHEN $19 THEN 'unverified' ELSE source_verification END,
         answer_key_verification = CASE WHEN $19 THEN 'unverified' ELSE answer_key_verification END,
         status = CASE WHEN $19 AND status = 'published' THEN 'unpublished' ELSE status END,
         version = version + 1, updated_at = now() WHERE id = $1`,
      [id, b.topicId ?? null, b.subtopicId !== undefined, b.subtopicId ?? null, b.difficulty ?? null, b.stem ?? null, answer, b.tolerance ?? null, b.estimatedTimeSec ?? null,
       b.examYear !== undefined, b.examYear ?? null, b.examSlot !== undefined, b.examSlot ?? null, b.marksCorrect ?? null, b.marksWrong ?? null, changedAnswerOrSolution,
       b.questionNumber !== undefined, b.questionNumber ?? null, pyqNeedsReview],
      c,
    );
    if (newOptions) {
      await query('DELETE FROM question_options WHERE question_id = $1', [id], c);
      for (const [k, v] of Object.entries(newOptions)) {
        if (!/^[A-F]$/.test(k)) throw badRequest('Option keys must be A–F');
        await query('INSERT INTO question_options(question_id, key, text_md) VALUES ($1,$2,$3)', [id, k, v], c);
      }
    }
    if (b.solution) {
      const s = b.solution;
      const existing = await one('SELECT 1 FROM question_solutions WHERE question_id = $1', [id], c);
      if (!existing && !s.learn) throw badRequest('A new solution needs a step-by-step explanation');
      await query(
        `INSERT INTO question_solutions(question_id, learn_md) VALUES ($1, $2) ON CONFLICT (question_id) DO NOTHING`,
        [id, s.learn ?? ''],
        c,
      );
      await query(
        `UPDATE question_solutions SET learn_md = coalesce($2, learn_md), exam_method_md = coalesce($3, exam_method_md), hints = coalesce($4, hints),
           verification_md = coalesce($5, verification_md), common_mistakes_md = coalesce($6, common_mistakes_md), distractors = coalesce($7, distractors),
           concepts_tested = coalesce($8, concepts_tested), prerequisites = coalesce($9, prerequisites), alternative_md = coalesce($10, alternative_md),
           advanced_md = coalesce($11, advanced_md), updated_at = now() WHERE question_id = $1`,
        [id, s.learn ?? null, s.examMethod ?? null, s.hints ?? null, s.verification ?? null, s.commonMistakes ?? null, s.distractors ?? null, s.conceptsTested ?? null,
         s.prerequisites ?? null, s.alternative ?? null, s.advanced ?? null],
        c,
      );
    }
    await audit(actor, 'question.update', 'question', id, { fields: Object.keys(b), reviewRequired: pyqNeedsReview }, c);
  });
  res.json({ ok: true, reviewRequired: pyqNeedsReview });
});

adminRouter.post('/questions/:id/verify', async (req, res) => {
  const id = uuidParam(req);
  const actor = userId(req);
  const b = parseBody(
    z.object({
      source: z.enum(['verified', 'unverified']).optional(),
      solution: z.enum(['verified', 'unverified']).optional(),
      sourceRef: z.object({ name: z.string().min(1), reference: z.string().min(1), url: z.string().url().optional(), license: z.string().default('') }).optional(),
      note: z.string().max(1000).optional(),
    }),
    req,
  );
  const q = await one('SELECT origin FROM questions WHERE id = $1', [id]);
  if (!q) throw notFound('Question');
  if (q.origin === 'authentic_pyq' && (b.source || b.solution)) throw badRequest('Authentic PYQs are verified by approving them in the review queue');
  if (b.source && q.origin !== 'reconstructed') throw badRequest('Source verification applies only to questions taken from a paper');
  if (b.source === 'verified') {
    const hasSource = await one('SELECT 1 FROM question_sources WHERE question_id = $1', [id]);
    if (!hasSource && !b.sourceRef) throw badRequest('Add a source reference before marking the source verified');
  }
  if (b.solution === 'verified') {
    const s = await one('SELECT learn_md FROM question_solutions WHERE question_id = $1', [id]);
    if (!s?.learn_md) throw badRequest('Add a solution before marking it verified');
  }
  await tx(async (c) => {
    if (b.sourceRef) {
      await query('INSERT INTO question_sources(question_id, source_name, reference, url, license_note, verified_by, verified_at) VALUES ($1,$2,$3,$4,$5,$6, now())', [
        id, b.sourceRef.name, b.sourceRef.reference, b.sourceRef.url ?? null, b.sourceRef.license, actor,
      ], c);
    }
    if (b.source) {
      await query('UPDATE questions SET source_verification = $2, updated_at = now() WHERE id = $1', [id, b.source], c);
      if (b.source === 'verified') await query('UPDATE question_sources SET verified_by = $2, verified_at = now() WHERE question_id = $1 AND verified_at IS NULL', [id, actor], c);
    }
    if (b.solution) await query('UPDATE questions SET solution_verification = $2, updated_at = now() WHERE id = $1', [id, b.solution], c);
    await audit(actor, 'question.verify', 'question', id, { source: b.source, solution: b.solution, note: b.note }, c);
  });
  res.json(await one('SELECT id, source_verification, solution_verification FROM questions WHERE id = $1', [id]));
});

adminRouter.post('/questions/:id/status', async (req, res) => {
  const id = uuidParam(req);
  const b = parseBody(z.object({ status: z.enum(['draft', 'published', 'unpublished']) }), req);
  const q = await one('SELECT question_type, correct_answer, origin, source_verification, review_status FROM questions WHERE id = $1', [id]);
  if (!q) throw notFound('Question');
  if (b.status === 'published') {
    if (q.origin === 'authentic_pyq' && q.review_status !== 'approved') throw badRequest('Approve this PYQ in the review queue before publishing a question labelled as an authentic CAT PYQ');
    const sol = await one('SELECT learn_md FROM question_solutions WHERE question_id = $1', [id]);
    if (!sol?.learn_md) throw badRequest('Cannot publish without a solution');
    if (q.question_type === 'MCQ') {
      const k = await one('SELECT 1 FROM question_options WHERE question_id = $1 AND key = $2', [id, q.correct_answer]);
      if (!k) throw badRequest('Cannot publish: answer is not a valid option');
    }
  }
  await query('UPDATE questions SET status = $2, updated_at = now() WHERE id = $1', [id, b.status]);
  await audit(userId(req), `question.${b.status}`, 'question', id);
  res.json({ id, status: b.status });
});

adminRouter.get('/questions/:id/versions/:versionId', async (req, res) => {
  const v = await one('SELECT * FROM question_versions WHERE id = $1 AND question_id = $2', [uuidParam(req, 'versionId'), uuidParam(req)]);
  if (!v) throw notFound('Version');
  res.json(v);
});

adminRouter.get('/audit', async (req, res) => {
  const f = parseQuery(pagination.extend({ entityType: z.string().max(40).optional() }), req);
  res.json({
    items: await many(
      `SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ($1::text IS NULL OR a.entity_type = $1)
        ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
      [f.entityType ?? null, f.pageSize, (f.page - 1) * f.pageSize],
    ),
  });
});

adminRouter.get('/quality', async (_req, res) => {
  const r = await one(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'published') AS published,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM question_solutions s WHERE s.question_id = q.id)) AS missing_solution,
            count(*) FILTER (WHERE solution_verification = 'unverified') AS solution_unverified,
            count(*) FILTER (WHERE origin = 'authentic_pyq') AS pyq,
            count(*) FILTER (WHERE origin = 'authentic_pyq' AND review_status = 'approved') AS pyq_verified,
            count(*) FILTER (WHERE origin = 'authentic_pyq' AND review_status = 'pending') AS pyq_pending_review,
            count(*) FILTER (WHERE origin = 'reconstructed') AS unverified_historical,
            count(*) FILTER (WHERE origin = 'authentic_pyq' AND NOT EXISTS (SELECT 1 FROM question_sources s WHERE s.question_id = q.id)) AS pyq_no_source,
            count(*) FILTER (WHERE section_id = 'DILR' AND dilr_set_id IS NULL) AS dilr_unlinked
       FROM questions q`,
  );
  res.json(r);
});

// --------------------------------------------------------- review queue for authentic PYQs
const confirmBody = z.object({
  confirm: z.object({ paperSource: z.boolean(), answerKey: z.boolean(), solution: z.boolean() }),
  note: z.string().max(2000).default(''),
  publish: z.boolean().default(true),
});

adminRouter.get('/review', async (req, res) => {
  const f = parseQuery(z.object({ status: z.enum(['pending', 'rejected', 'approved']).default('pending') }), req);
  res.json(await reviewQueue(f.status));
});

adminRouter.post('/review/questions/:id/approve', async (req, res) => {
  res.json(await approveQuestion(uuidParam(req), userId(req), parseBody(confirmBody, req)));
});

adminRouter.post('/review/groups/:kind/:id/approve', async (req, res) => {
  const kind = z.enum(['passage', 'dilr_set']).parse(req.params.kind);
  res.json(await approveGroup(kind, uuidParam(req), userId(req), parseBody(confirmBody, req)));
});

adminRouter.post('/review/reject', async (req, res) => {
  const b = parseBody(z.object({ questionIds: z.array(z.string().uuid()).min(1).max(100), note: z.string().max(2000) }), req);
  res.json(await rejectQuestions(b.questionIds, userId(req), b.note));
});

// --------------------------------------------------------- exam pattern versions
const sectionBody = z.object({
  sectionId: z.enum(['VARC', 'DILR', 'QA']),
  position: z.number().int().min(1).max(3),
  durationMin: z.number().int().positive().max(300),
  questionCount: z.number().int().positive().max(200),
  mcqCorrect: z.number().positive().max(10),
  mcqWrong: z.number().min(-10).max(0),
  titaCorrect: z.number().positive().max(10),
  titaWrong: z.number().min(-10).max(0),
});
const examConfigBody = z.object({
  year: z.number().int().min(2000).max(2100),
  name: z.string().min(1).max(100),
  totalDurationMin: z.number().int().positive().max(600),
  sectionalLock: z.boolean(),
  sourceNote: z.string().max(2000).default(''),
  sections: z.array(sectionBody).min(1).max(3),
});

adminRouter.get('/exam-configs', async (_req, res) => {
  res.json({ items: await listConfigs(), fields: PATTERN_FIELD_KEYS });
});

/** Adds a new version. Existing versions are never overwritten. */
adminRouter.post('/exam-configs', async (req, res) => {
  const b = parseBody(examConfigBody.extend({ supersedesId: z.string().uuid().optional() }), req);
  const id = await createConfigVersion(b, userId(req), b.supersedesId);
  res.status(201).json(await loadConfig(id));
});

adminRouter.patch('/exam-configs/:id', async (req, res) => {
  await updateDraft(uuidParam(req), parseBody(examConfigBody, req), userId(req));
  res.json(await loadConfig(uuidParam(req)));
});

adminRouter.post('/exam-configs/:id/sources', async (req, res) => {
  const b = parseBody(
    z.object({
      kind: z.enum(['official', 'secondary']),
      title: z.string().min(1).max(300),
      publisher: z.string().max(200).default(''),
      url: z.string().url().max(1000).optional(),
      accessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      supports: z.string().max(2000).default(''),
      note: z.string().max(2000).default(''),
    }),
    req,
  );
  res.status(201).json(await addSource(uuidParam(req), b, userId(req)));
});

adminRouter.delete('/exam-configs/:id/sources/:sourceId', async (req, res) => {
  await removeSource(uuidParam(req), uuidParam(req, 'sourceId'), userId(req));
  res.status(204).end();
});

adminRouter.post('/exam-configs/:id/verify', async (req, res) => {
  const field = z.enum(PATTERN_FIELD_KEYS as [string, ...string[]]);
  const b = parseBody(z.object({ verify: z.record(field, z.string().uuid()).optional(), unverify: z.array(field).optional() }), req);
  await setFieldStatus(uuidParam(req), b as any, userId(req));
  res.json(await loadConfig(uuidParam(req)));
});

adminRouter.post('/exam-configs/:id/activate', async (req, res) => {
  await activate(uuidParam(req), userId(req));
  res.json(await loadConfig(uuidParam(req)));
});

// --------------------------------------------------------- email delivery status
adminRouter.get('/email', async (_req, res) => {
  res.json(await emailStatus());
});

/** Sends a test message to the signed-in admin and reports exactly what the provider said. */
adminRouter.post('/email/test', async (req, res) => {
  const r = await sendMail(
    { to: req.user!.email, subject: 'CAT 100 test email', text: 'This is a test message from CAT 100. If you can read it, email delivery works.' },
    { purpose: 'test', userId: userId(req) },
  );
  res.json({ provider: getEmailProvider().name, configured: getEmailProvider().configured, ...r });
});

// --------------------------------------------------------- image uploads (diagrams)
const SIGNATURES: [string, Buffer][] = [
  ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ['jpg', Buffer.from([0xff, 0xd8, 0xff])],
  ['webp', Buffer.from('RIFF')],
];

adminRouter.post('/uploads', async (req, res) => {
  const b = parseBody(z.object({ filename: z.string().max(200), dataBase64: z.string().max(3_000_000) }), req);
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw badRequest('Image must be between 1 byte and 2 MB');
  const kind = SIGNATURES.find(([, sig]) => buf.subarray(0, sig.length).equals(sig))?.[0];
  if (!kind || (kind === 'webp' && buf.subarray(8, 12).toString() !== 'WEBP')) throw badRequest('Only PNG, JPEG or WebP images are accepted');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${kind}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  await audit(userId(req), 'upload.create', 'upload', name, { originalName: b.filename, bytes: buf.length });
  res.status(201).json({ path: `/uploads/${name}`, markdown: `![${b.filename.replace(/[[\]]/g, '')}](/uploads/${name})` });
});
