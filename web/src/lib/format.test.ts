import { describe, expect, it } from 'vitest';
import { PROVENANCE_LABEL, provenanceOf } from './format';

describe('provenance labels', () => {
  it('calls a question a verified CAT PYQ only after approval with a verified source and answer key', () => {
    const pyq = { origin: 'authentic_pyq', review_status: 'approved', source_verification: 'verified', answer_key_verification: 'verified' };
    expect(provenanceOf(pyq)).toBe('verified_pyq');
    expect(provenanceOf({ ...pyq, review_status: 'pending' })).toBe('pyq_under_review');
    expect(provenanceOf({ ...pyq, answer_key_verification: 'unverified' })).toBe('pyq_under_review');
    expect(provenanceOf({ origin: 'authentic_pyq' })).toBe('pyq_under_review');
  });

  it('labels recollections as unverified historical and everything else as practice', () => {
    expect(provenanceOf({ origin: 'reconstructed', source_verification: 'verified' })).toBe('unverified_historical');
    expect(provenanceOf({ origin: 'original_practice' })).toBe('original_practice');
    expect(provenanceOf({ origin: 'inspired' })).toBe('cat_style_practice');
    expect(provenanceOf({ origin: 'ai_generated' })).toBe('ai_generated');
    expect(PROVENANCE_LABEL[provenanceOf({ origin: 'original_practice' })]).toBe('Original practice');
  });

  it('trusts the provenance the server computed', () => {
    expect(provenanceOf({ origin: 'authentic_pyq', provenance: 'verified_pyq' })).toBe('verified_pyq');
  });
});
