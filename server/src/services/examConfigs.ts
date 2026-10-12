/**
 * Versioned exam patterns. A pattern is never edited in place once it is active, verified in any
 * part, or used by a test: changes become a new version, and old versions keep scoring the
 * tests that were built with them. Each simulator setting is verified separately against an
 * official source.
 */
import type pg from 'pg';
import { many, one, pool, query, tx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

export const PATTERN_FIELDS = {
  section_order: 'Section order',
  section_durations: 'Time per section',
  total_duration: 'Total duration',
  question_counts: 'Questions per section',
  question_types: 'Question formats (MCQ and TITA)',
  marking_correct: 'Marks for a correct answer',
  marking_mcq_wrong: 'Negative marks for a wrong MCQ answer',
  marking_tita_wrong: 'Marks for a wrong TITA answer',
  unanswered: 'Unanswered questions score zero',
  sectional_lock: 'No switching between sections',
} as const;
export type PatternField = keyof typeof PATTERN_FIELDS;
export const PATTERN_FIELD_KEYS = Object.keys(PATTERN_FIELDS) as PatternField[];

export interface SectionInput {
  sectionId: 'VARC' | 'DILR' | 'QA';
  position: number;
  durationMin: number;
  questionCount: number;
  mcqCorrect: number;
  mcqWrong: number;
  titaCorrect: number;
  titaWrong: number;
}

export interface ConfigInput {
  year: number;
  name: string;
  totalDurationMin: number;
  sectionalLock: boolean;
  sourceNote: string;
  sections: SectionInput[];
}

type Db = pg.Pool | pg.PoolClient;

function overallStatus(fieldStatus: Record<string, any>) {
  const verified = PATTERN_FIELD_KEYS.filter((f) => fieldStatus?.[f]?.status === 'verified').length;
  if (verified === PATTERN_FIELD_KEYS.length) return 'verified' as const;
  return verified > 0 ? ('partially_verified' as const) : ('unverified' as const);
}

export async function loadConfig(id: string, db: Db = pool) {
  const c = await one('SELECT * FROM exam_configs WHERE id = $1', [id], db);
  if (!c) return null;
  const sections = await many('SELECT * FROM exam_config_sections WHERE exam_config_id = $1 ORDER BY position', [id], db);
  const sources = await many('SELECT * FROM exam_config_sources WHERE exam_config_id = $1 ORDER BY kind, created_at', [id], db);
  const usage = await one('SELECT count(*) AS n FROM mock_tests WHERE exam_config_id = $1', [id], db);
  const fieldStatus = c.field_status ?? {};
  const status = overallStatus(fieldStatus);
  const testsUsing = Number(usage?.n ?? 0);
  const anyVerified = PATTERN_FIELD_KEYS.some((f) => fieldStatus[f]?.status === 'verified');
  return {
    ...c,
    sections,
    sources,
    fields: PATTERN_FIELD_KEYS.map((key) => ({ key, label: PATTERN_FIELDS[key], status: fieldStatus[key]?.status ?? 'unverified', sourceId: fieldStatus[key]?.sourceId ?? null, verifiedAt: fieldStatus[key]?.verifiedAt ?? null })),
    status,
    label: `${c.name} (version ${c.version}, ${status.replace('_', ' ')})`,
    testsUsing,
    editable: !c.is_active && !anyVerified && testsUsing === 0,
  };
}
export type LoadedConfig = NonNullable<Awaited<ReturnType<typeof loadConfig>>>;

export async function activeConfig(db: Db = pool) {
  const row = await one('SELECT id FROM exam_configs WHERE is_active LIMIT 1', [], db);
  if (!row) throw notFound('Active exam pattern');
  return (await loadConfig(row.id, db))!;
}

/** Latest version recorded for an exam year, or null. */
export async function configForYear(year: number, db: Db = pool) {
  const row = await one('SELECT id FROM exam_configs WHERE year = $1 ORDER BY version DESC LIMIT 1', [year], db);
  return row ? loadConfig(row.id, db) : null;
}

export async function listConfigs() {
  const rows = await many('SELECT id FROM exam_configs ORDER BY year DESC, version DESC');
  return Promise.all(rows.map((r) => loadConfig(r.id).then((c) => c!)));
}

function validateInput(b: ConfigInput) {
  const positions = b.sections.map((s) => s.position).sort();
  if (new Set(b.sections.map((s) => s.sectionId)).size !== b.sections.length) throw badRequest('Each section can appear once');
  if (positions.some((p, i) => p !== i + 1)) throw badRequest('Section positions must be 1, 2, 3 in order');
  const sum = b.sections.reduce((t, s) => t + s.durationMin, 0);
  if (b.sectionalLock && sum !== b.totalDurationMin) throw badRequest(`Section times add up to ${sum} minutes but the total is ${b.totalDurationMin}`);
}

async function writeSections(c: pg.PoolClient, id: string, sections: SectionInput[]) {
  await query('DELETE FROM exam_config_sections WHERE exam_config_id = $1', [id], c);
  for (const s of sections) {
    await query(
      'INSERT INTO exam_config_sections(exam_config_id, section_id, position, duration_min, question_count, mcq_correct, mcq_wrong, tita_correct, tita_wrong) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, s.sectionId, s.position, s.durationMin, s.questionCount, s.mcqCorrect, s.mcqWrong, s.titaCorrect, s.titaWrong],
      c,
    );
  }
}

/** Adds a new version for the year. It starts unverified and inactive. */
export async function createConfigVersion(b: ConfigInput, actor: string | null, supersedesId?: string) {
  validateInput(b);
  return tx(async (c) => {
    const next = await one('SELECT coalesce(max(version), 0) + 1 AS v FROM exam_configs WHERE year = $1', [b.year], c);
    const row = await one(
      `INSERT INTO exam_configs(year, version, name, total_duration_min, sectional_lock, verification_status, source_note, supersedes_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'unverified',$6,$7,$8) RETURNING id`,
      [b.year, next!.v, b.name, b.totalDurationMin, b.sectionalLock, b.sourceNote, supersedesId ?? null, actor],
      c,
    );
    await writeSections(c, row!.id, b.sections);
    await audit(actor, 'exam_config.create', 'exam_config', row!.id, { ...b, version: next!.v, supersedesId: supersedesId ?? null }, c);
    return row!.id as string;
  });
}

export async function updateDraft(id: string, b: ConfigInput, actor: string) {
  const cur = await loadConfig(id);
  if (!cur) throw notFound('Exam pattern');
  if (!cur.editable) throw conflict('This pattern is active, partly verified or used by tests. Create a new version instead.');
  if (cur.year !== b.year) throw badRequest('Create a new pattern for a different year');
  validateInput(b);
  await tx(async (c) => {
    await query('UPDATE exam_configs SET name = $2, total_duration_min = $3, sectional_lock = $4, source_note = $5 WHERE id = $1', [id, b.name, b.totalDurationMin, b.sectionalLock, b.sourceNote], c);
    await writeSections(c, id, b.sections);
    await audit(actor, 'exam_config.update', 'exam_config', id, b, c);
  });
}

export async function addSource(
  id: string,
  s: { kind: 'official' | 'secondary'; title: string; publisher: string; url?: string; accessedOn?: string; supports: string; note: string },
  actor: string | null,
  db?: pg.PoolClient,
) {
  const run = async (c: pg.PoolClient) => {
    const cfg = await one('SELECT id FROM exam_configs WHERE id = $1', [id], c);
    if (!cfg) throw notFound('Exam pattern');
    const row = await one(
      `INSERT INTO exam_config_sources(exam_config_id, kind, title, publisher, url, accessed_on, supports, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, s.kind, s.title, s.publisher, s.url ?? null, s.accessedOn ?? null, s.supports, s.note, actor],
      c,
    );
    await audit(actor, 'exam_config.source_add', 'exam_config', id, { sourceId: row!.id, kind: s.kind, title: s.title, url: s.url ?? null }, c);
    return row!;
  };
  return db ? run(db) : tx(run);
}

export async function removeSource(id: string, sourceId: string, actor: string) {
  const cfg = await loadConfig(id);
  if (!cfg) throw notFound('Exam pattern');
  if (cfg.fields.some((f: { status: string; sourceId: string | null }) => f.status === 'verified' && f.sourceId === sourceId)) throw conflict('A verified setting cites this source. Mark that setting unverified first.');
  const r = await query('DELETE FROM exam_config_sources WHERE id = $1 AND exam_config_id = $2', [sourceId, id]);
  if (!r.rowCount) throw notFound('Source');
  await audit(actor, 'exam_config.source_remove', 'exam_config', id, { sourceId });
}

/**
 * Marks settings verified against an official source of this pattern, or unverified.
 * Secondary sources (coaching sites, news, encyclopedias) can be recorded but never verify.
 */
export async function setFieldStatus(id: string, body: { verify?: Partial<Record<PatternField, string>>; unverify?: PatternField[] }, actor: string) {
  return tx(async (c) => {
    const cfg = await one('SELECT * FROM exam_configs WHERE id = $1 FOR UPDATE', [id], c);
    if (!cfg) throw notFound('Exam pattern');
    const status = { ...(cfg.field_status ?? {}) };
    for (const [field, sourceId] of Object.entries(body.verify ?? {})) {
      if (!(field in PATTERN_FIELDS)) throw badRequest(`Unknown setting '${field}'`);
      const src = await one('SELECT kind FROM exam_config_sources WHERE id = $1 AND exam_config_id = $2', [sourceId, id], c);
      if (!src) throw badRequest(`Source for '${field}' is not attached to this pattern`);
      if (src.kind !== 'official') throw badRequest(`'${PATTERN_FIELDS[field as PatternField]}' can only be verified against an official source`);
      status[field] = { status: 'verified', sourceId, verifiedBy: actor, verifiedAt: new Date().toISOString() };
    }
    for (const field of body.unverify ?? []) delete status[field];
    const overall = overallStatus(status);
    await query('UPDATE exam_configs SET field_status = $2, verification_status = $3, verified_by = $4, verified_at = $5 WHERE id = $1', [
      id,
      status,
      overall === 'verified' ? 'verified' : 'unverified',
      overall === 'verified' ? actor : null,
      overall === 'verified' ? new Date() : null,
    ], c);
    await audit(actor, 'exam_config.verify', 'exam_config', id, { verify: body.verify ?? {}, unverify: body.unverify ?? [], overall }, c);
    return overall;
  });
}

/** Makes this version the one used for new tests. Earlier tests keep the version they were built with. */
export async function activate(id: string, actor: string) {
  return tx(async (c) => {
    const cfg = await one('SELECT id, is_active FROM exam_configs WHERE id = $1 FOR UPDATE', [id], c);
    if (!cfg) throw notFound('Exam pattern');
    const prev = await one('SELECT id FROM exam_configs WHERE is_active', [], c);
    if (prev?.id === id) return id;
    await query('UPDATE exam_configs SET is_active = false WHERE is_active', [], c);
    await query('UPDATE exam_configs SET is_active = true WHERE id = $1', [id], c);
    await audit(actor, 'exam_config.activate', 'exam_config', id, { previous: prev?.id ?? null }, c);
    return id;
  });
}

/** Summary shown to learners: which pattern new tests use and whether it matches their exam year. */
export async function learnerPattern(userId: string) {
  const active = await activeConfig();
  const profile = await one('SELECT exam_year FROM user_profiles WHERE user_id = $1', [userId]);
  const examYear: number | null = profile?.exam_year ?? null;
  const forYear = examYear && examYear !== active.year ? await configForYear(examYear) : null;
  const summary = (c: LoadedConfig) => ({
    id: c.id,
    year: c.year,
    version: c.version,
    name: c.name,
    status: c.status,
    label: c.label,
    totalDurationMin: c.total_duration_min,
    sectionalLock: c.sectional_lock,
    sections: c.sections.map((s: any) => ({
      sectionId: s.section_id,
      durationMin: s.duration_min,
      questionCount: s.question_count,
      mcqCorrect: s.mcq_correct,
      mcqWrong: s.mcq_wrong,
      titaCorrect: s.tita_correct,
      titaWrong: s.tita_wrong,
    })),
    sources: c.sources.map((s: any) => ({ kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, accessedOn: s.accessed_on })),
  });
  return {
    active: summary(active),
    examYear,
    matchesExamYear: examYear === null ? null : examYear === active.year,
    forExamYear: forYear ? summary(forYear) : null,
  };
}
