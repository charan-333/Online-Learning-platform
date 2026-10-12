import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRows, parseJson, parseJsonl } from '../src/modules/admin/importFormats.js';
import { answerMatchesKey, jaccard, shingles, validateItems, type ExistingContent } from '../src/modules/admin/validateImport.js';

// Test fixtures only: invented items that never reach the database, labelled as such.
const existing: ExistingContent = {
  topicIds: new Set(['qa-percentages', 'rc-humanities']),
  topicSection: new Map([['qa-percentages', 'QA'], ['rc-humanities', 'VARC']]),
  subtopicIds: new Set(),
  passageIds: new Set(['practice-passage']),
  setIds: new Set(),
  questionIds: new Set(['db-pyq']),
  stemHashes: new Map(),
  pyqNumbers: new Map([['2022-1-QA-7', 'db-pyq']]),
  stemShingles: new Map([['db-other', shingles('FIXTURE: a train of length 120 m crosses a pole in 6 seconds; find its speed in km per hour')]]),
  groupMeta: new Map([['practice-passage', { origin: 'original_practice', examYear: null, examSlot: null }]]),
};

const solution = { learn: 'Fixture working.', hints: ['h'], verification: 'Fixture check.', distractors: { A: 'a', C: 'c', D: 'd' } };
const pyq = (over: Record<string, unknown> = {}) => ({
  kind: 'question', externalId: 'fx-pyq-1', section: 'QA', topic: 'qa-percentages', type: 'MCQ', difficulty: 'medium',
  stem: 'FIXTURE (not a CAT question): what is 25% of 80?', options: { A: '10', B: '20', C: '30', D: '40' }, answer: 'B', estimatedTimeSec: 60,
  origin: 'authentic_pyq', examYear: 2022, examSlot: 1, questionNumber: 3,
  sources: [{ name: 'Fixture paper', reference: 'Fixture slot 1 QA Q3' }],
  answerKey: { name: 'Fixture key', reference: 'Fixture key slot 1', answer: 'B' },
  solution, ...over,
});
const codes = (r: ReturnType<typeof validateItems>, sev: 'error' | 'warning' = 'error') => r.issues.filter((i) => i.severity === sev).map((i) => i.code);

describe('CSV parsing', () => {
  it('handles quoted commas, escaped quotes, line breaks, CRLF and a byte-order mark', () => {
    const rows = parseCsvRows('﻿a,b,c\r\n"x, y","he said ""hi""","line one\nline two"\r\n\r\n1,2,3');
    expect(rows.map((r) => r.cells)).toEqual([['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line one\nline two'], ['1', '2', '3']]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it('turns rows into passage and question items with sources, answer key and solution', () => {
    const csv = [
      'record_type,external_id,origin,section,topic,type,difficulty,title,domain,body,stem,option_a,option_b,answer,estimated_time_sec,exam_year,exam_slot,question_number,passage,position,source_name,source_reference,answer_key_name,answer_key_reference,answer_key_answer,solution_learn,solution_hints,solution_verification,distractor_a,tags',
      'passage,fx-p,authentic_pyq,,,,medium,Fixture passage,Humanities,"Fixture body, with a comma.",,,,,,2022,1,,,,Fixture paper,Fixture VARC passage 1,,,,,,,,',
      'question,fx-q,authentic_pyq,VARC,rc-humanities,MCQ,medium,,,,FIXTURE stem,Yes,No,B,90,2022,1,1,fx-p,1,Fixture paper,Fixture VARC Q1,Fixture key,Fixture key VARC,B,Fixture working,first || second,Fixture check,Not supported by the passage,rc;fixture',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.issues).toEqual([]);
    expect(r.lines).toEqual([2, 3]);
    const [p, q] = r.items as any[];
    expect(p).toMatchObject({ kind: 'passage', externalId: 'fx-p', body: 'Fixture body, with a comma.', examYear: 2022, source: { name: 'Fixture paper', reference: 'Fixture VARC passage 1' } });
    expect(q).toMatchObject({
      kind: 'question', questionNumber: 1, passage: 'fx-p', position: 1, options: { A: 'Yes', B: 'No' },
      answerKey: { name: 'Fixture key', reference: 'Fixture key VARC', answer: 'B' },
      solution: { learn: 'Fixture working', hints: ['first', 'second'], verification: 'Fixture check', distractors: { A: 'Not supported by the passage' } },
      tags: ['rc', 'fixture'],
    });
  });

  it('rejects unknown columns, a missing record_type column and rows wider than the header', () => {
    expect(parseCsv('record_type,stemm\nquestion,x').issues[0].code).toBe('unknown_column');
    expect(parseCsv('external_id\nx').issues[0].code).toBe('file_format');
    const wide = parseCsv('record_type,external_id\nquestion,a,extra');
    expect(wide.items).toHaveLength(0);
    expect(wide.issues[0].message).toMatch(/^Line 2:/);
  });
});

describe('JSON and JSON Lines parsing', () => {
  it('accepts an array or {items}, and reports bad JSON', () => {
    expect(parseJson('[{"a":1}]').items).toHaveLength(1);
    expect(parseJson('{"items":[{"a":1},{"b":2}]}').items).toHaveLength(2);
    expect(parseJson('{"a":1}').issues[0].code).toBe('file_format');
    expect(parseJson('{').issues[0].code).toBe('file_format');
  });
  it('reads one item per line and reports the broken line', () => {
    const r = parseJsonl('{"a":1}\n\n{"b":2}\nnot json\n');
    expect(r.items).toHaveLength(2);
    expect(r.lines).toEqual([1, 3]);
    expect(r.issues[0].message).toMatch(/^Line 4:/);
  });
});

describe('authentic PYQ validation', () => {
  it('accepts a complete PYQ record', () => {
    expect(codes(validateItems([pyq()], existing))).toEqual([]);
  });

  it('requires the question number and an answer key that agrees with the answer', () => {
    expect(codes(validateItems([pyq({ questionNumber: undefined })], existing))).toContain('incomplete_record');
    expect(codes(validateItems([pyq({ answerKey: undefined })], existing))).toContain('missing_answer_key');
    expect(codes(validateItems([pyq({ answerKey: { name: 'K', reference: 'R', answer: 'C' } })], existing))).toContain('answer_key_mismatch');
  });

  it('compares TITA answers with the key numerically', () => {
    expect(answerMatchesKey('TITA', '1,200', '1200')).toBe(true);
    expect(answerMatchesKey('TITA', '12.5', '12.50')).toBe(true);
    expect(answerMatchesKey('TITA', '12', '13')).toBe(false);
    expect(answerMatchesKey('MCQ', 'b', 'B')).toBe(true);
  });

  it('detects the same paper question twice, in the file or already stored', () => {
    const r = validateItems([pyq(), pyq({ externalId: 'fx-pyq-2', stem: 'FIXTURE: a different stem entirely' })], existing);
    expect(codes(r)).toContain('duplicate_pyq_number');
    expect(codes(validateItems([pyq({ questionNumber: 7, stem: 'FIXTURE: yet another stem' })], existing))).toContain('duplicate_pyq_number');
  });

  it('warns about near-duplicate text', () => {
    const near = 'FIXTURE: a train of length 120 m crosses a pole in 6 seconds; find its speed in km per hr';
    expect(jaccard(shingles(near), existing.stemShingles!.get('db-other')!)).toBeGreaterThan(0.8);
    const r = validateItems([pyq({ origin: 'original_practice', examYear: undefined, examSlot: undefined, questionNumber: undefined, sources: undefined, answerKey: undefined, stem: near })], existing);
    expect(codes(r, 'warning')).toContain('near_duplicate');
    expect(codes(r)).toEqual([]);
  });

  it('lets memory-based reconstructions name their paper but never makes them PYQs', () => {
    const r = validateItems([pyq({ origin: 'reconstructed', answerKey: undefined })], existing);
    expect(codes(r)).toEqual([]);
    expect(codes(validateItems([pyq({ origin: 'inspired', answerKey: undefined, sources: undefined })], existing))).toContain('year_on_non_pyq');
  });

  it('keeps PYQ questions and their passage from the same paper', () => {
    const passage = { kind: 'passage', externalId: 'fx-pp', title: 'T', domain: 'D', difficulty: 'medium', body: 'Fixture body', origin: 'authentic_pyq', examYear: 2022, examSlot: 1, source: { name: 'Fixture paper', reference: 'P1' } };
    const q = (over: Record<string, unknown>) => pyq({ section: 'VARC', topic: 'rc-humanities', passage: 'fx-pp', position: 1, ...over });
    expect(codes(validateItems([passage, q({})], existing))).toEqual([]);
    expect(codes(validateItems([passage, q({ examSlot: 2 })], existing))).toContain('group_mismatch');
    expect(codes(validateItems([q({ passage: 'practice-passage' })], existing))).toContain('group_mismatch');
    expect(codes(validateItems([{ ...passage, source: undefined }], existing))).toContain('missing_provenance');
  });

  it('warns that verification flags in a file are ignored for PYQs', () => {
    expect(codes(validateItems([pyq({ sourceVerified: true, solutionVerified: true })], existing), 'warning')).toContain('verification_flags_ignored');
  });
});
