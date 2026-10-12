import { importItem, type PassageItem, type QuestionItem, type SetItem } from './importSchema.js';

export interface Issue {
  index: number;
  externalId?: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ExistingContent {
  topicIds: Set<string>;
  topicSection: Map<string, string>;
  subtopicIds: Set<string>;
  passageIds: Set<string>;
  setIds: Set<string>;
  questionIds: Set<string>;
  stemHashes: Map<string, string>; // normalised stem -> external id
}

export const normaliseStem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CURRENT_YEAR = new Date().getUTCFullYear();
const FIRST_CAT_YEAR = 1990; // conservative lower bound for any CAT paper year
const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/**
 * Validates an import batch without touching the database. Errors block the item;
 * warnings are reported but allowed. Checks: schema, duplicates (within the file and
 * against existing content), missing answers/solutions, invalid MCQ options, TITA
 * answer format, exam year/slot metadata, provenance for authentic PYQs, image
 * references, and question-to-passage/set links.
 */
export function validateItems(raw: unknown[], existing: ExistingContent) {
  const issues: Issue[] = [];
  const valid: { index: number; item: QuestionItem | PassageItem | SetItem }[] = [];
  const seenIds = new Map<string, number>();
  const seenStems = new Map<string, string>();
  const filePassages = new Set<string>();
  const fileSets = new Set<string>();

  const parsed = raw.map((r, index) => {
    const res = importItem.safeParse(r);
    if (!res.success) {
      const ext = (r as any)?.externalId;
      for (const e of res.error.issues) {
        issues.push({ index, externalId: ext, severity: 'error', code: 'schema', message: `${e.path.join('.') || 'item'}: ${e.message}` });
      }
      return null;
    }
    return res.data;
  });

  // Passages and sets are validated first so questions only link to valid groups.
  const order = parsed.map((_, i) => i).sort((a, b) => Number(parsed[a]?.kind === 'question') - Number(parsed[b]?.kind === 'question'));
  for (const index of order) {
    const item = parsed[index];
    if (!item) continue;
    const err = (code: string, message: string) => issues.push({ index, externalId: item.externalId, severity: 'error', code, message });
    const warn = (code: string, message: string) => issues.push({ index, externalId: item.externalId, severity: 'warning', code, message });
    const before = issues.filter((i) => i.severity === 'error').length;

    if (seenIds.has(item.externalId)) err('duplicate_id', `Duplicate externalId in file (also at item ${seenIds.get(item.externalId)})`);
    seenIds.set(item.externalId, index);

    // Provenance & exam metadata
    const isPyq = item.origin === 'authentic_pyq';
    if (!isPyq && (item.examYear !== undefined || item.examSlot !== undefined)) {
      err('year_on_non_pyq', 'Only authentic PYQs may carry an exam year or slot');
    }
    if (isPyq) {
      if (item.examYear === undefined) err('missing_year', 'Authentic PYQs must have an exam year');
      else if (item.examYear < FIRST_CAT_YEAR || item.examYear > CURRENT_YEAR) err('invalid_year', `Exam year ${item.examYear} is outside ${FIRST_CAT_YEAR}–${CURRENT_YEAR}`);
      if (item.examSlot !== undefined && (item.examSlot < 1 || item.examSlot > 3)) err('invalid_slot', 'Exam slot must be 1, 2, or 3');
    }

    const bodies: string[] = [];
    if (item.kind === 'question') {
      bodies.push(item.stem, ...(item.options ? Object.values(item.options) : []), item.solution?.learn ?? '');
      if (existing.questionIds.has(item.externalId)) warn('exists', 'A question with this externalId already exists; it will be updated as a new version');
      if (!existing.topicIds.has(item.topic)) err('unknown_topic', `Unknown topic '${item.topic}'`);
      else if (existing.topicSection.get(item.topic) !== item.section) err('topic_section_mismatch', `Topic '${item.topic}' is not in section ${item.section}`);
      if (item.subtopic && !existing.subtopicIds.has(item.subtopic)) err('unknown_subtopic', `Unknown subtopic '${item.subtopic}'`);

      const stemKey = normaliseStem(item.stem);
      const dupInFile = seenStems.get(stemKey);
      const dupInDb = existing.stemHashes.get(stemKey);
      if (dupInFile && dupInFile !== item.externalId) err('duplicate_stem', `Same question text as ${dupInFile} in this file`);
      else if (dupInDb && dupInDb !== item.externalId) err('duplicate_stem', `Same question text as existing question ${dupInDb}`);
      seenStems.set(stemKey, item.externalId);

      if (!item.answer.trim()) err('missing_answer', 'Answer is empty');
      if (item.type === 'MCQ') {
        const keys = Object.keys(item.options ?? {});
        if (keys.length < 2) err('invalid_options', 'MCQ needs at least two options');
        if (keys.some((k) => !/^[A-F]$/.test(k))) err('invalid_options', 'Option keys must be single letters A–F');
        const texts = Object.values(item.options ?? {}).map((t) => normaliseStem(t));
        if (new Set(texts).size !== texts.length) err('invalid_options', 'Two options have the same text');
        if (texts.some((t) => !t)) err('invalid_options', 'An option is empty');
        if (!keys.includes(item.answer)) err('answer_not_in_options', `Answer '${item.answer}' is not one of the option keys`);
      } else {
        if (item.options && Object.keys(item.options).length) err('tita_options', 'TITA questions must not have options');
        if (!/^-?\d+(\.\d+)?$/.test(item.answer.trim()) && !/^[A-Za-z0-9]+$/.test(item.answer.trim())) {
          err('tita_answer_format', 'TITA answer must be a number or a short alphanumeric sequence');
        }
      }
      if (!item.solution) err('missing_solution', 'Every question needs a solution');
      else {
        if (item.type === 'MCQ') {
          const wrongKeys = Object.keys(item.options ?? {}).filter((k) => k !== item.answer);
          const missing = wrongKeys.filter((k) => !item.solution!.distractors[k]);
          if (missing.length) warn('distractors_incomplete', `No explanation for why option(s) ${missing.join(', ')} are wrong`);
        }
        if (!item.solution.hints.length) warn('no_hints', 'No progressive hints provided');
        if (!item.solution.verification) warn('no_verification', 'No final-answer verification step');
      }
      if (isPyq) {
        if (!item.sources?.length) err('missing_provenance', 'Authentic PYQs need at least one source reference');
        else if (item.sources.some((s) => !s.reference)) err('missing_provenance', 'Each source must include a reference (paper, slot, question number)');
      }
      if (item.passage && item.set) err('two_groups', 'A question cannot belong to both a passage and a DILR set');
      if (item.passage && !filePassages.has(item.passage) && !existing.passageIds.has(item.passage)) err('unknown_passage', `Passage '${item.passage}' not found`);
      if (item.set && !fileSets.has(item.set) && !existing.setIds.has(item.set)) err('unknown_set', `DILR set '${item.set}' not found`);
      if (item.section === 'DILR' && !item.set) warn('dilr_without_set', 'DILR questions should belong to a complete set');
      if ((item.passage || item.set) && !item.position) warn('no_position', 'Grouped questions should have a position within their passage or set');
    } else {
      bodies.push(item.body);
      if (item.kind === 'passage' && !item.centralArgument) warn('no_analysis', 'Passage has no central-argument analysis');
      if (item.kind === 'dilr_set' && !item.deductions) warn('no_analysis', 'DILR set has no deduction walkthrough');
    }

    for (const body of bodies) {
      for (const m of body.matchAll(IMAGE_RE)) {
        const src = m[1];
        if (!/^https:\/\/[^\s]+$/.test(src) && !/^\/uploads\/[\w./-]+\.(png|jpe?g|svg|webp)$/i.test(src)) {
          err('broken_image', `Image reference '${src}' must be an https URL or an /uploads/ image path`);
        }
      }
      if ((body.match(/\|/g) ?? []).length > 0 && /\n\|/.test(body) && !/\n\|[\s:-]+\|/.test(body)) {
        warn('table_format', 'Table rows found without a markdown header separator row');
      }
    }

    if (issues.filter((i) => i.severity === 'error').length === before) {
      valid.push({ index, item });
      if (item.kind === 'passage') filePassages.add(item.externalId);
      if (item.kind === 'dilr_set') fileSets.add(item.externalId);
    }
  }

  // Groups referenced by rejected questions are fine; but a passage/set with no valid question is suspicious.
  for (const { item, index } of valid) {
    if (item.kind === 'passage' && !valid.some((v) => v.item.kind === 'question' && v.item.passage === item.externalId)) {
      issues.push({ index, externalId: item.externalId, severity: 'warning', code: 'empty_group', message: 'Passage has no valid questions in this file' });
    }
    if (item.kind === 'dilr_set' && !valid.some((v) => v.item.kind === 'question' && v.item.set === item.externalId)) {
      issues.push({ index, externalId: item.externalId, severity: 'warning', code: 'empty_group', message: 'DILR set has no valid questions in this file' });
    }
  }

  return { issues, valid };
}
