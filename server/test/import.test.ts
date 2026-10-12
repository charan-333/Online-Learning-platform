import { describe, expect, it } from 'vitest';
import { validateItems, type ExistingContent } from '../src/modules/admin/validateImport.js';

const existing: ExistingContent = {
  topicIds: new Set(['qa-percentages', 'lr-arrangements', 'rc-humanities']),
  topicSection: new Map([['qa-percentages', 'QA'], ['lr-arrangements', 'DILR'], ['rc-humanities', 'VARC']]),
  subtopicIds: new Set(),
  passageIds: new Set(['existing-passage']),
  setIds: new Set(),
  questionIds: new Set(['already-there']),
  stemHashes: new Map([['what is 10 percent of 50', 'already-there']]),
};

const solution = { learn: 'Explain.', hints: ['h'], verification: 'v', distractors: { A: 'a', C: 'c' } };
const mcq = (over: Record<string, unknown> = {}) => ({
  kind: 'question', externalId: 'imp-q-1', section: 'QA', topic: 'qa-percentages', type: 'MCQ', difficulty: 'easy',
  stem: 'A unique stem about percentages', options: { A: '1', B: '2', C: '3' }, answer: 'B', estimatedTimeSec: 60,
  origin: 'original_practice', solution, ...over,
});
const codes = (r: ReturnType<typeof validateItems>, sev: 'error' | 'warning' = 'error') => r.issues.filter((i) => i.severity === sev).map((i) => i.code);

describe('import validation', () => {
  it('accepts a clean original-practice MCQ', () => {
    const r = validateItems([mcq()], existing);
    expect(codes(r)).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });
  it('rejects schema errors', () => {
    const r = validateItems([{ kind: 'question', externalId: 'x' }], existing);
    expect(codes(r)).toContain('schema');
    expect(r.valid).toHaveLength(0);
  });
  it('rejects duplicate ids and stems within a file and against the database', () => {
    const r = validateItems([mcq(), mcq({ stem: 'Different stem' }), mcq({ externalId: 'imp-q-2' }), mcq({ externalId: 'imp-q-3', stem: 'What is 10 percent of 50?' })], existing);
    expect(codes(r)).toEqual(expect.arrayContaining(['duplicate_id', 'duplicate_stem']));
    expect(r.issues.filter((i) => i.code === 'duplicate_stem')).toHaveLength(2);
  });
  it('warns when an existing question will be versioned', () => {
    const r = validateItems([mcq({ externalId: 'already-there', stem: 'What is 10 percent of 50?' })], existing);
    expect(codes(r, 'warning')).toContain('exists');
    expect(codes(r)).toEqual([]);
  });
  it('rejects invalid MCQ options and answers', () => {
    expect(codes(validateItems([mcq({ answer: 'E' })], existing))).toContain('answer_not_in_options');
    expect(codes(validateItems([mcq({ options: { A: '1' }, answer: 'A' })], existing))).toContain('invalid_options');
    expect(codes(validateItems([mcq({ options: { A: '1', B: '1' } })], existing))).toContain('invalid_options');
    expect(codes(validateItems([mcq({ options: { A: '1', b: '2' }, answer: 'A' })], existing))).toContain('invalid_options');
  });
  it('checks TITA format', () => {
    expect(codes(validateItems([mcq({ type: 'TITA', options: undefined, answer: '42' })], existing))).toEqual([]);
    expect(codes(validateItems([mcq({ type: 'TITA', options: undefined, answer: 'forty two!' })], existing))).toContain('tita_answer_format');
    expect(codes(validateItems([mcq({ type: 'TITA', answer: '42' })], existing))).toContain('tita_options');
  });
  it('requires a solution', () => {
    expect(codes(validateItems([mcq({ solution: undefined })], existing))).toContain('missing_solution');
  });
  it('forbids exam year/slot on anything that is not an authentic PYQ', () => {
    expect(codes(validateItems([mcq({ examYear: 2023 })], existing))).toContain('year_on_non_pyq');
    expect(codes(validateItems([mcq({ origin: 'inspired', examSlot: 1 })], existing))).toContain('year_on_non_pyq');
  });
  it('requires year, valid slot and provenance on authentic PYQs', () => {
    const base = { origin: 'authentic_pyq' };
    expect(codes(validateItems([mcq(base)], existing))).toEqual(expect.arrayContaining(['missing_year', 'missing_provenance']));
    expect(codes(validateItems([mcq({ ...base, examYear: 1980, sources: [{ name: 'Paper', reference: 'Q1' }] })], existing))).toContain('invalid_year');
    expect(codes(validateItems([mcq({ ...base, examYear: 2023, examSlot: 4, sources: [{ name: 'Paper', reference: 'Q1' }] })], existing))).toContain('invalid_slot');
    expect(codes(validateItems([mcq({ ...base, examYear: 2023, examSlot: 1, sources: [{ name: 'Paper' }] })], existing))).toContain('missing_provenance');
    expect(codes(validateItems([mcq({ ...base, examYear: 2023, examSlot: 1, sources: [{ name: 'Paper', reference: 'Slot 1 QA Q4' }] })], existing))).toEqual([]);
  });
  it('rejects unknown topics and section mismatches', () => {
    expect(codes(validateItems([mcq({ topic: 'nope' })], existing))).toContain('unknown_topic');
    expect(codes(validateItems([mcq({ topic: 'lr-arrangements' })], existing))).toContain('topic_section_mismatch');
  });
  it('rejects broken image references', () => {
    expect(codes(validateItems([mcq({ stem: 'See ![fig](file:///etc/passwd)' })], existing))).toContain('broken_image');
    expect(codes(validateItems([mcq({ stem: 'See ![fig](https://example.org/a.png)' })], existing))).toEqual([]);
    expect(codes(validateItems([mcq({ stem: 'See ![fig](/uploads/abc.png)' })], existing))).toEqual([]);
  });
  it('validates passage links: in-file, existing, unknown, and invalid groups', () => {
    const passage = { kind: 'passage', externalId: 'imp-p-1', title: 'T', domain: 'Humanities', difficulty: 'medium', body: 'Body', origin: 'original_practice' };
    const rc = (id: string, p: string) => mcq({ externalId: id, section: 'VARC', topic: 'rc-humanities', stem: `Stem ${id}`, passage: p, position: 1 });
    // question listed before its passage still links
    const r1 = validateItems([rc('imp-rc-1', 'imp-p-1'), passage], existing);
    expect(codes(r1)).toEqual([]);
    expect(codes(validateItems([rc('imp-rc-2', 'existing-passage')], existing))).toEqual([]);
    expect(codes(validateItems([rc('imp-rc-3', 'ghost')], existing))).toContain('unknown_passage');
    // a passage that fails schema does not make its questions linkable
    const r2 = validateItems([{ ...passage, body: '' }, rc('imp-rc-4', 'imp-p-1')], existing);
    expect(codes(r2)).toEqual(expect.arrayContaining(['schema', 'unknown_passage']));
    // passage with no questions in file is flagged
    expect(codes(validateItems([passage], existing), 'warning')).toContain('empty_group');
  });
  it('rejects a question in both a passage and a set, and warns on DILR without a set', () => {
    expect(codes(validateItems([mcq({ passage: 'existing-passage', set: 'x' })], existing))).toContain('two_groups');
    expect(codes(validateItems([mcq({ section: 'DILR', topic: 'lr-arrangements' })], existing), 'warning')).toContain('dilr_without_set');
  });
});
