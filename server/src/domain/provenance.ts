/**
 * How a question is presented to learners. Only approved questions whose paper source and
 * answer key were verified are "verified CAT PYQs"; the database refuses to publish any other
 * authentic-PYQ row, so learners never see 'pyq_under_review'.
 */
export type Provenance = 'verified_pyq' | 'pyq_under_review' | 'unverified_historical' | 'original_practice' | 'cat_style_practice' | 'ai_generated';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified_pyq: 'Verified CAT PYQ',
  pyq_under_review: 'CAT PYQ awaiting review',
  unverified_historical: 'Unverified historical question',
  original_practice: 'Original practice',
  cat_style_practice: 'CAT-style practice',
  ai_generated: 'AI-generated practice',
};

export interface ProvenanceInput {
  origin: string;
  review_status?: string | null;
  source_verification?: string | null;
  answer_key_verification?: string | null;
}

export function provenanceOf(q: ProvenanceInput): Provenance {
  switch (q.origin) {
    case 'authentic_pyq':
      return q.review_status === 'approved' && q.source_verification === 'verified' && q.answer_key_verification === 'verified' ? 'verified_pyq' : 'pyq_under_review';
    case 'reconstructed':
      return 'unverified_historical';
    case 'inspired':
      return 'cat_style_practice';
    case 'ai_generated':
      return 'ai_generated';
    default:
      return 'original_practice';
  }
}

/** The same rule in SQL, for a questions table aliased as q. */
export const PROVENANCE_SQL = `CASE
  WHEN q.origin = 'authentic_pyq' AND q.review_status = 'approved' AND q.source_verification = 'verified' AND q.answer_key_verification = 'verified' THEN 'verified_pyq'
  WHEN q.origin = 'authentic_pyq' THEN 'pyq_under_review'
  WHEN q.origin = 'reconstructed' THEN 'unverified_historical'
  WHEN q.origin = 'inspired' THEN 'cat_style_practice'
  WHEN q.origin = 'ai_generated' THEN 'ai_generated'
  ELSE 'original_practice' END`;

/**
 * Provenance of a passage or DILR set (alias g). A group from a CAT paper counts as verified only
 * after its review approval; until then learners do not see it at all (GROUP_VISIBLE_SQL).
 */
export const GROUP_PROVENANCE_SQL = `CASE
  WHEN g.origin = 'authentic_pyq' AND g.source_verification = 'verified' THEN 'verified_pyq'
  WHEN g.origin = 'authentic_pyq' THEN 'pyq_under_review'
  WHEN g.origin = 'reconstructed' THEN 'unverified_historical'
  WHEN g.origin = 'inspired' THEN 'cat_style_practice'
  WHEN g.origin = 'ai_generated' THEN 'ai_generated'
  ELSE 'original_practice' END`;
export const GROUP_VISIBLE_SQL = `(g.origin <> 'authentic_pyq' OR g.source_verification = 'verified')`;

/** Learner-facing filter groups. */
export const PROVENANCE_FILTERS = {
  verified_pyq: "q.origin = 'authentic_pyq'",
  unverified_historical: "q.origin = 'reconstructed'",
  practice: "q.origin IN ('original_practice', 'inspired', 'ai_generated')",
} as const;
