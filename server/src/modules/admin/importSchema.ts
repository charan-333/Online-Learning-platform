import { z } from 'zod';

export const ORIGINS = ['authentic_pyq', 'reconstructed', 'inspired', 'original_practice', 'ai_generated'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'difficult', 'advanced'] as const;

const solutionSchema = z.object({
  conceptsTested: z.string().default(''),
  prerequisites: z.string().default(''),
  learn: z.string().min(1),
  examMethod: z.string().default(''),
  hints: z.array(z.string()).default([]),
  verification: z.string().default(''),
  commonMistakes: z.string().default(''),
  distractors: z.record(z.string()).default({}),
  alternative: z.string().optional(),
  advanced: z.string().optional(),
});

const sourceSchema = z.object({
  name: z.string().min(1),
  reference: z.string().default(''),
  url: z.string().url().optional(),
  license: z.string().default(''),
});

export const questionItem = z.object({
  kind: z.literal('question'),
  externalId: z.string().min(3).max(120),
  section: z.enum(['VARC', 'DILR', 'QA']),
  topic: z.string().min(1),
  subtopic: z.string().optional(),
  type: z.enum(['MCQ', 'TITA']),
  difficulty: z.enum(DIFFICULTIES),
  stem: z.string().min(1),
  options: z.record(z.string()).optional(),
  answer: z.string().min(1),
  tolerance: z.number().min(0).optional(),
  estimatedTimeSec: z.number().int().positive(),
  origin: z.enum(ORIGINS),
  examYear: z.number().int().optional(),
  examSlot: z.number().int().optional(),
  marksCorrect: z.number().optional(),
  marksWrong: z.number().optional(),
  sources: z.array(sourceSchema).optional(),
  // Set only by an admin after checking the question against its source.
  sourceVerified: z.boolean().optional(),
  solutionVerified: z.boolean().optional(),
  passage: z.string().optional(),
  set: z.string().optional(),
  position: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  solution: solutionSchema.optional(),
});

export const passageItem = z.object({
  kind: z.literal('passage'),
  externalId: z.string().min(3).max(120),
  title: z.string().min(1),
  domain: z.string().min(1),
  difficulty: z.enum(DIFFICULTIES),
  body: z.string().min(1),
  centralArgument: z.string().default(''),
  structure: z.string().default(''),
  purposeTone: z.string().default(''),
  vocabulary: z.string().default(''),
  origin: z.enum(ORIGINS),
  examYear: z.number().int().optional(),
  examSlot: z.number().int().optional(),
});

export const setItem = z.object({
  kind: z.literal('dilr_set'),
  externalId: z.string().min(3).max(120),
  title: z.string().min(1),
  setType: z.string().min(1),
  difficulty: z.enum(DIFFICULTIES),
  body: z.string().min(1),
  structure: z.string().default(''),
  deductions: z.string().default(''),
  selection: z.string().default(''),
  origin: z.enum(ORIGINS),
  examYear: z.number().int().optional(),
  examSlot: z.number().int().optional(),
  estimatedTimeSec: z.number().int().positive().default(900),
});

export const importItem = z.discriminatedUnion('kind', [questionItem, passageItem, setItem]);
export type ImportItem = z.input<typeof importItem>;
export type QuestionItem = z.output<typeof questionItem>;
export type PassageItem = z.output<typeof passageItem>;
export type SetItem = z.output<typeof setItem>;

export const importFile = z.object({
  items: z.array(z.unknown()).min(1).max(2000),
});
