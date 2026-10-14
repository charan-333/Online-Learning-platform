import { isCorrect } from '../../domain/scoring.js';
import { HISTORICAL_ORIGINS, importItem, type PassageItem, type QuestionItem, type SetItem } from './importSchema.js';

export interface Issue {
  index: number;
  /** Line in the uploaded file, when the format has lines (CSV, JSON Lines). */
  line?: number;
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
  /** `${year}-${slot}-${section}-${number}` -> external id, for authentic PYQs. */
  pyqNumbers?: Map<string, string>;
  /** For near-duplicate detection: external id -> word shingles of the stem. */
  stemShingles?: Map<string, Set<string>>;
  /** Existing passages and sets, for checking that PYQ questions sit in PYQ groups from the same paper. */
  groupMeta?: Map<string, { origin: string; examYear: number | null; examSlot: number | null }>;
}

export const normaliseStem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Three-word shingles of a stem, for near-duplicate detection. */
export function shingles(stem: string): Set<string> {
  const words = normaliseStem(stem).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length < 3) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i + 3 <= words.length; i++) out.add(words.slice(i, i + 3).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Stems this similar are reported as possible duplicates. */
export const NEAR_DUPLICATE_THRESHOLD = 0.8;

export const pyqKey = (year: number, slot: number | null | undefined, section: string, n: number) => `${year}-${slot ?? 0}-${section}-${n}`;

/** Does the stored answer agree with the answer key entry? */
export function answerMatchesKey(type: 'MCQ' | 'TITA', answer: string, keyAnswer: string, tolerance = 0) {
  if (type === 'MCQ') return answer.trim().toUpperCase() === keyAnswer.trim().toUpperCase();
  return isCorrect({ question_type: 'TITA', correct_answer: answer, answer_tolerance: tolerance }, keyAnswer);
}

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
  const seenPyqNumbers = new Map<string, string>();
  const fileShingles = new Map<string, Set<string>>();
  const fileGroupMeta = new Map<string, { origin: string; examYear: number | null; examSlot: number | null }>();

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

    // Provenance & exam metadata. Memory-based reconstructions may say which paper they claim to
    // come from; they are always shown as unverified historical questions.
    const isPyq = item.origin === 'authentic_pyq';
    const isHistorical = HISTORICAL_ORIGINS.has(item.origin);
    const questionNumber = item.kind === 'question' ? item.questionNumber : undefined;
    if (!isHistorical && (item.examYear !== undefined || item.examSlot !== undefined || questionNumber !== undefined)) {
      err('year_on_non_pyq', 'Only authentic PYQs and memory-based reconstructions may carry an exam year, slot or question number');
    }
    if (isHistorical) {
      if (item.examYear === undefined) {
        if (isPyq) err('missing_year', 'Authentic PYQs must have an exam year');
      } else if (item.examYear < FIRST_CAT_YEAR || item.examYear > CURRENT_YEAR) err('invalid_year', `Exam year ${item.examYear} is outside ${FIRST_CAT_YEAR}–${CURRENT_YEAR}`);
      if (item.examSlot !== undefined && (item.examSlot < 1 || item.examSlot > 3)) err('invalid_slot', 'Exam slot must be 1, 2, or 3');
      if (isPyq && item.examSlot === undefined) warn('no_slot', 'No exam slot given. Record it if the paper had more than one slot.');
    }
    if (isPyq && ((item as QuestionItem).sourceVerified !== undefined || (item as QuestionItem).solutionVerified !== undefined)) {
      warn('verification_flags_ignored', 'Verification flags in the file are ignored for authentic PYQs. Approve them in the review queue.');
    }
    if (item.kind !== 'question' && isPyq && !item.source) err('missing_provenance', 'A passage or DILR set from a CAT paper needs a source with a reference');

    const bodies: string[] = [];
    if (item.kind === 'question') {
      bodies.push(item.stem, ...(item.options ? Object.values(item.options) : []), item.solution?.learn ?? '');
      if (existing.questionIds.has(item.externalId)) {
        warn('exists', isPyq
          ? 'A question with this externalId already exists; it will be updated as a new version and must be reviewed again before learners see it'
          : 'A question with this externalId already exists; it will be updated as a new version');
      }
      if (!existing.topicIds.has(item.topic)) err('unknown_topic', `Unknown topic '${item.topic}'`);
      else if (existing.topicSection.get(item.topic) !== item.section) err('topic_section_mismatch', `Topic '${item.topic}' is not in section ${item.section}`);
      if (item.subtopic && !existing.subtopicIds.has(item.subtopic)) err('unknown_subtopic', `Unknown subtopic '${item.subtopic}'`);

      const stemKey = normaliseStem(item.stem);
      const dupInFile = seenStems.get(stemKey);
      const dupInDb = existing.stemHashes.get(stemKey);
      if (dupInFile && dupInFile !== item.externalId) err('duplicate_stem', `Same question text as ${dupInFile} in this file`);
      else if (dupInDb && dupInDb !== item.externalId) err('duplicate_stem', `Same question text as existing question ${dupInDb}`);
      else {
        const mine = shingles(item.stem);
        let best: { id: string; score: number } | null = null;
        for (const [id, sh] of [...fileShingles, ...(existing.stemShingles ?? new Map())]) {
          if (id === item.externalId) continue;
          const score = jaccard(mine, sh);
          if (score >= NEAR_DUPLICATE_THRESHOLD && (!best || score > best.score)) best = { id, score };
        }
        if (best) warn('near_duplicate', `Question text is ${Math.round(best.score * 100)}% similar to ${best.id}. Check it is not the same question.`);
        fileShingles.set(item.externalId, mine);
      }
      seenStems.set(stemKey, item.externalId);

      if (isPyq) {
        if (item.questionNumber === undefined) err('incomplete_record', 'Authentic PYQs need the question number from the paper');
        else if (item.examYear !== undefined) {
          const key = pyqKey(item.examYear, item.examSlot, item.section, item.questionNumber);
          const inFile = seenPyqNumbers.get(key);
          const inDb = existing.pyqNumbers?.get(key);
          if (inFile && inFile !== item.externalId) err('duplicate_pyq_number', `${item.examYear} slot ${item.examSlot ?? '-'} ${item.section} question ${item.questionNumber} is also ${inFile} in this file`);
          else if (inDb && inDb !== item.externalId) err('duplicate_pyq_number', `${item.examYear} slot ${item.examSlot ?? '-'} ${item.section} question ${item.questionNumber} already exists as ${inDb}`);
          seenPyqNumbers.set(key, item.externalId);
        }
        if (!item.answerKey) err('missing_answer_key', 'Authentic PYQs need an answer-key reference and the answer it gives');
        else if (!answerMatchesKey(item.type, item.answer, item.answerKey.answer, item.tolerance ?? 0)) {
          err('answer_key_mismatch', `Answer '${item.answer}' does not match the answer key ('${item.answerKey.answer}')`);
        }
      }

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
        if (!item.sources?.some((s) => s.kind === 'question_paper')) err('missing_provenance', 'Authentic PYQs need a question-paper source reference');
        else if (item.sources.some((s) => !s.reference)) err('missing_provenance', 'Each source must include a reference (paper, slot, question number)');
        if (item.solution && item.type === 'MCQ') {
          const wrongKeys = Object.keys(item.options ?? {}).filter((k) => k !== item.answer);
          if (wrongKeys.some((k) => !item.solution!.distractors[k])) warn('review_blocker', 'Approval will need an explanation for every wrong option');
        }
        if (item.solution && !item.solution.verification) warn('review_blocker', 'Approval will need a final-answer verification step');
      }
      if (item.passage && item.set) err('two_groups', 'A question cannot belong to both a passage and a DILR set');
      if (item.passage && !filePassages.has(item.passage) && !existing.passageIds.has(item.passage)) err('unknown_passage', `Passage '${item.passage}' not found`);
      if (item.set && !fileSets.has(item.set) && !existing.setIds.has(item.set)) err('unknown_set', `DILR set '${item.set}' not found`);
      const groupRef = item.passage ?? item.set;
      const group = groupRef ? (fileGroupMeta.get(groupRef) ?? existing.groupMeta?.get(groupRef)) : undefined;
      if (group) {
        const groupIsPyq = group.origin === 'authentic_pyq';
        if (groupIsPyq !== isPyq) err('group_mismatch', `Question origin '${item.origin}' does not match its ${item.passage ? 'passage' : 'set'} ('${group.origin}')`);
        else if (isPyq && (group.examYear !== (item.examYear ?? null) || group.examSlot !== (item.examSlot ?? null))) {
          err('group_mismatch', 'Question and its passage or set must come from the same paper (year and slot)');
        }
      }
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
      if (item.kind !== 'question') fileGroupMeta.set(item.externalId, { origin: item.origin, examYear: item.examYear ?? null, examSlot: item.examSlot ?? null });
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
