# Importing and verifying CAT PYQs

This is the procedure for adding previous-year questions. Read [PYQ-SOURCES.md](PYQ-SOURCES.md)
first: import only material you have the right to reproduce.

## Three kinds of content

| `origin` in the file | What learners see | How it gets there |
|---|---|---|
| `authentic_pyq` | **Verified PYQ · CAT 2023 · Slot 1 · Q5** | Imported, then approved by an admin in the review queue. Hidden from learners until then. |
| `reconstructed` | **Unverified historical · CAT 2023 · …** | Imported and published like practice. Never shown as a CAT PYQ. |
| `original_practice`, `inspired`, `ai_generated` | Original practice / CAT-style practice / AI-generated practice | Imported and published. May not carry a year, slot or question number. |

The database enforces the first row: an `authentic_pyq` question cannot be published unless its
review is approved and its paper source, answer key and solution are all verified
(`questions_published_pyq_verified`).

## 1. Prepare the file

Admin → **Import** accepts JSON (`[...]` or `{"items": [...]}`), JSON Lines (one item per line) or
CSV, up to 2,000 items and 4.5 MB. Each item is a `question`, `passage` or `dilr_set`.

**CSV.** Download the header-only template from Admin → Import, or use
[`pyq-import-template.csv`](pyq-import-template.csv). One row per record; `record_type` is
`question`, `passage` or `dilr_set`. Separate hints with `||` and tags with `;`. Quote cells that
contain commas, quotes or line breaks (standard RFC 4180). Unknown columns are rejected.

| Columns | Meaning |
|---|---|
| `external_id`, `origin`, `section`, `topic`, `subtopic`, `type`, `difficulty` | Identity and classification. `type` is `MCQ` or `TITA`. |
| `stem`, `option_a` … `option_f`, `answer`, `tolerance`, `estimated_time_sec` | The question exactly as printed. Markdown, `$…$` for maths. |
| `exam_year`, `exam_slot`, `question_number` | Where it appears in the paper (`question_number` within the section). |
| `passage` / `set`, `position` | Links a question to a passage or DILR set in the same file or already stored. |
| `source_name`, `source_reference`, `source_url`, `source_license`, `source_accessed_on` | The question paper. On a `passage` or `dilr_set` row, the paper it comes from. |
| `answer_key_name`, `answer_key_reference`, `answer_key_url`, `answer_key_answer`, `answer_key_accessed_on` | The official answer key and the answer it gives. |
| `solution_learn`, `solution_exam_method`, `solution_hints`, `solution_verification`, … , `distractor_a` … `distractor_f` | The worked solution, a final-answer check, and why each wrong option is wrong. |
| `title`, `domain`, `body`, `central_argument`, … , `set_type`, `deductions`, `selection` | Passage and DILR set fields. |

**JSON / JSON Lines.** The same fields in camelCase; the schema is
`server/src/modules/admin/importSchema.ts` and the import page shows an example. Sources go in
`sources: [{ name, reference, url?, kind?, accessedOn? }]`, the key in
`answerKey: { name, reference, url?, answer, accessedOn? }`, and a passage or set's paper in
`source: { name, reference, url? }`.

**Required for `authentic_pyq`:** exam year, question number, a question-paper source with a
reference, an answer key whose answer matches `answer` (numerically for TITA), and a solution.
A missing slot is a warning (fine for single-slot years). A passage or set from a paper needs its
own source and the same year and slot as its questions. Verification flags in the file
(`sourceVerified`, `solutionVerified`) are ignored for PYQs.

## 2. Validate, then import

Click **Validate (dry run)**. Nothing is written. The report lists errors (the item is skipped)
and warnings, with the CSV or JSON Lines line number. Checks include:

- schema, unknown topics, broken passage/set links, MCQ answer not among the options, TITA format;
- `missing_provenance`, `incomplete_record`, `missing_answer_key`, `answer_key_mismatch`;
- `duplicate_pyq_number`: the same year, slot, section and question number twice, in the file or
  already stored;
- duplicate text (exact match) and `near_duplicate` (at least 80% overlap of three-word phrases)
  against the file and the bank;
- `group_mismatch`: a PYQ question and its passage or set from different papers;
- `review_blocker` warnings for things approval will require, such as a missing explanation for a
  wrong option.

Then **Import**. The job records the file name, format and SHA-256 of the file. PYQs land as
drafts with review status *pending*, whatever the file or the publish box says.

## 3. Review and approve

Admin → **PYQ review** lists pending submissions. Standalone questions are reviewed one by one;
a passage or DILR set is reviewed together with all its questions and approved as one unit.
Each question shows automated checks:

| Check | Blocks approval |
|---|---|
| Paper source recorded with a reference | yes |
| Answer-key source recorded with the answer it gives | yes |
| Stored answer matches the answer key | yes |
| Answer is valid (an option for MCQ, a number or short code for TITA) | yes |
| Solution has steps, a verification step and explanations for every wrong option | yes |
| Exam year and question number recorded | yes |
| No other question has the same text | yes |
| Passage or set is from the same paper and has a source | yes |
| Slot recorded | no (warning) |

To approve, open the cited paper and key and tick all three confirmations: you compared the text,
options and numbering with the paper; you checked the answer against the key; you worked through
the solution. Approval marks the paper source, answer key and solution verified, records who
approved it and when, and publishes it unless you untick that box. **Reject** needs a note and keeps
the item hidden.

## 4. Revisions and history

- Editing a PYQ's text, options, answer, solution, year, slot or question number sends it back to
  *pending* and unpublishes it. Re-importing the same `external_id` does the same.
- Re-importing a passage or set with a changed text or title sends its PYQ questions back to review
  and marks the passage or set unverified again.
- Every edit and re-import stores the previous version (`question_versions`, `group_versions`,
  including sources) and an audit-log entry. Approvals and rejections are audited too.

## How verified PYQs are used

- Question bank: **Source** filter (verified PYQs, unverified historical, practice) and a badge on
  every question, passage and set.
- Practice selection and lessons: among questions the learner has not seen, verified PYQs come
  first. Lesson worked examples prefer non-PYQ questions so PYQs stay fresh for practice.
- Mocks: within each section, verified PYQ passages, sets and questions are chosen before
  practice items. A previous-year paper uses only approved PYQs from that year and slot, in paper
  order, timed and scored with that year's exam pattern.
- Revision shows the provenance badge on each question card.
