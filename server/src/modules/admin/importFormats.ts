/**
 * Turns JSON, JSON Lines and CSV files into import items. Every format ends up as the same item
 * objects, so the same validation runs on all of them. Parse problems are reported per line.
 */
import type { Issue } from './validateImport.js';

export type ImportFormat = 'json' | 'jsonl' | 'csv';

export interface ParsedFile {
  items: unknown[];
  /** Source line for each item (1-based), so the report can point at the row to fix. */
  lines: number[];
  issues: Issue[];
}

const fileIssue = (code: string, message: string, line?: number): Issue => ({ index: -1, severity: 'error', code, message: line ? `Line ${line}: ${message}` : message });

export function parseJson(content: string): ParsedFile {
  try {
    const data = JSON.parse(content);
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
    if (!items) return { items: [], lines: [], issues: [fileIssue('file_format', 'Expected an array of items or an object with an "items" array')] };
    return { items, lines: items.map(() => 0), issues: [] };
  } catch (e) {
    return { items: [], lines: [], issues: [fileIssue('file_format', `Not valid JSON: ${(e as Error).message}`)] };
  }
}

export function parseJsonl(content: string): ParsedFile {
  const out: ParsedFile = { items: [], lines: [], issues: [] };
  content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      out.items.push(JSON.parse(line));
      out.lines.push(i + 1);
    } catch (e) {
      out.issues.push(fileIssue('file_format', `not valid JSON (${(e as Error).message})`, i + 1));
    }
  });
  return out;
}

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and line breaks. Returns rows with their starting line. */
export function parseCsvRows(content: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const text = content.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      if (cells.some((c) => c !== '')) rows.push({ cells, line: rowLine });
      cells = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += ch;
  }
  cells.push(cell);
  if (cells.some((c) => c !== '')) rows.push({ cells, line: rowLine });
  return rows;
}

const OPTION_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Every column a CSV import may use. Unknown columns are rejected so typos are caught. */
export const CSV_COLUMNS = [
  'record_type', 'external_id', 'origin', 'section', 'topic', 'subtopic', 'type', 'difficulty', 'stem',
  ...OPTION_KEYS.map((k) => `option_${k}`),
  'answer', 'tolerance', 'estimated_time_sec', 'exam_year', 'exam_slot', 'question_number', 'passage', 'set', 'position', 'marks_correct', 'marks_wrong',
  'source_name', 'source_reference', 'source_url', 'source_license', 'source_accessed_on',
  'answer_key_name', 'answer_key_reference', 'answer_key_url', 'answer_key_answer', 'answer_key_accessed_on',
  'solution_learn', 'solution_exam_method', 'solution_hints', 'solution_verification', 'solution_common_mistakes', 'solution_concepts',
  'solution_prerequisites', 'solution_alternative', 'solution_advanced',
  ...OPTION_KEYS.map((k) => `distractor_${k}`),
  'tags', 'title', 'domain', 'body', 'central_argument', 'structure', 'purpose_tone', 'vocabulary', 'set_type', 'deductions', 'selection',
] as const;

const num = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : v; // keep the text so validation reports it
};
const str = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : v);
const compact = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

function rowToItem(r: Record<string, string>): unknown {
  const kind = (r.record_type ?? '').trim();
  const common = compact({ externalId: str(r.external_id), origin: str(r.origin), difficulty: str(r.difficulty), examYear: num(r.exam_year), examSlot: num(r.exam_slot) });
  const groupSource = str(r.source_name) ? compact({ name: r.source_name, reference: str(r.source_reference) ?? '', url: str(r.source_url) }) : undefined;
  if (kind === 'passage') {
    return compact({
      kind, ...common, title: str(r.title), domain: str(r.domain), body: str(r.body), centralArgument: str(r.central_argument), structure: str(r.structure),
      purposeTone: str(r.purpose_tone), vocabulary: str(r.vocabulary), source: groupSource,
    });
  }
  if (kind === 'dilr_set') {
    return compact({
      kind, ...common, title: str(r.title), setType: str(r.set_type), body: str(r.body), structure: str(r.structure), deductions: str(r.deductions),
      selection: str(r.selection), estimatedTimeSec: num(r.estimated_time_sec), source: groupSource,
    });
  }
  const options = Object.fromEntries(OPTION_KEYS.map((k) => [k.toUpperCase(), str(r[`option_${k}`])]).filter(([, v]) => v !== undefined));
  const distractors = Object.fromEntries(OPTION_KEYS.map((k) => [k.toUpperCase(), str(r[`distractor_${k}`])]).filter(([, v]) => v !== undefined));
  const solution = str(r.solution_learn)
    ? compact({
        learn: r.solution_learn,
        examMethod: str(r.solution_exam_method),
        hints: str(r.solution_hints)?.split('||').map((h) => h.trim()).filter(Boolean),
        verification: str(r.solution_verification),
        commonMistakes: str(r.solution_common_mistakes),
        conceptsTested: str(r.solution_concepts),
        prerequisites: str(r.solution_prerequisites),
        alternative: str(r.solution_alternative),
        advanced: str(r.solution_advanced),
        distractors,
      })
    : undefined;
  const sources = str(r.source_name)
    ? [compact({ name: r.source_name, reference: str(r.source_reference) ?? '', url: str(r.source_url), license: str(r.source_license), accessedOn: str(r.source_accessed_on) })]
    : undefined;
  const answerKey = str(r.answer_key_name) || str(r.answer_key_answer)
    ? compact({ name: str(r.answer_key_name), reference: str(r.answer_key_reference), url: str(r.answer_key_url), answer: str(r.answer_key_answer), accessedOn: str(r.answer_key_accessed_on) })
    : undefined;
  return compact({
    kind: kind || undefined,
    ...common,
    section: str(r.section),
    topic: str(r.topic),
    subtopic: str(r.subtopic),
    type: str(r.type),
    stem: str(r.stem),
    options: Object.keys(options).length ? options : undefined,
    answer: str(r.answer),
    tolerance: num(r.tolerance),
    estimatedTimeSec: num(r.estimated_time_sec),
    questionNumber: num(r.question_number),
    passage: str(r.passage),
    set: str(r.set),
    position: num(r.position),
    marksCorrect: num(r.marks_correct),
    marksWrong: num(r.marks_wrong),
    sources,
    answerKey,
    solution,
    tags: str(r.tags)?.split(';').map((t) => t.trim()).filter(Boolean),
  });
}

export function parseCsv(content: string): ParsedFile {
  const rows = parseCsvRows(content);
  if (!rows.length) return { items: [], lines: [], issues: [fileIssue('file_format', 'The CSV file is empty')] };
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  const known = new Set<string>(CSV_COLUMNS);
  const unknown = header.filter((h) => h && !known.has(h));
  if (!header.includes('record_type')) return { items: [], lines: [], issues: [fileIssue('file_format', 'The header row must include a record_type column')] };
  if (unknown.length) return { items: [], lines: [], issues: [fileIssue('unknown_column', `Unknown column(s): ${unknown.join(', ')}`)] };
  const out: ParsedFile = { items: [], lines: [], issues: [] };
  for (const row of rows.slice(1)) {
    if (row.cells.length > header.length) {
      out.issues.push(fileIssue('file_format', `has ${row.cells.length} cells but the header has ${header.length}`, row.line));
      continue;
    }
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = row.cells[i] ?? ''));
    out.items.push(rowToItem(rec));
    out.lines.push(row.line);
  }
  return out;
}

export function parseImportFile(format: ImportFormat, content: string): ParsedFile {
  if (format === 'csv') return parseCsv(content);
  if (format === 'jsonl') return parseJsonl(content);
  return parseJson(content);
}
