# Exam pattern: findings and how to verify it

**Status (12 October 2026): the active pattern, "CAT 2024 pattern", version 1, is unverified.**
None of its ten settings has been checked against an official CAT document, because the official
CAT 2024 Information Bulletin could not be obtained from the build environment. Learners see it
labelled *not verified against an official source*, and the mock page asks them to treat timing and
marking as provisional.

## What the simulator uses now

| Setting | Value in version 1 | Verified? |
|---|---|---|
| Section order | VARC, DILR, QA | no |
| Time per section | 40 minutes each | no |
| Total duration | 120 minutes | no |
| Questions per section | VARC 24, DILR 22, QA 22 | no |
| Question formats | MCQ and TITA | no |
| Correct answer | +3 | no |
| Wrong MCQ answer | −1 | no |
| Wrong TITA answer | 0 | no |
| Unanswered question | 0 | no |
| Switching between sections | not allowed | no |

## Sources consulted

| Source | Kind | What it states | Verifies |
|---|---|---|---|
| [CAT 2024 advertisement](https://iiml.ac.in/hi/sites/default/files/upload/news/CAT_2024_Advertisement.pdf), IIM Lucknow, accessed 2026-10-12 | official | Computer-based test on 24 November 2024 in three sessions; registration 1 August to 13 September 2024. | nothing in the table: it gives no sections, timing, counts or marking |
| [Common Admission Test](https://en.wikipedia.org/wiki/Common_Admission_Test), Wikipedia, accessed 2026-10-12 | secondary | CAT 2024 as three 40-minute parts, 120 minutes in total (citing Shiksha); 68 questions split 24 VARC, 22 DILR, 22 QA for **CAT 2025** (citing IMS); +3 correct, −1 wrong MCQ, no negative marking for TITA (citing learningroutes.in). | nothing: secondary sources cannot verify a setting |
| CAT information bulletins on cdn.digialm.com | official | Search found bulletins for CAT 2023, 2025 and 2026. None was found for 2024, and none could be opened. | not used |

Both recorded sources are stored with the pattern (Admin → Exam pattern → Sources) with the text
above. Note the question counts come from a secondary source describing CAT 2025, not 2024.

## How patterns are stored

- Each pattern is a **version** for one exam year (`exam_configs.year`, `version`). Exactly one
  version is active; new tests use it. Every test keeps the version it was built with, and its
  per-question marks are copied into the test, so changing the active pattern never re-scores
  past attempts.
- A version is frozen once it is active, has any verified setting, or is used by a test. Changes go
  into a new version (**Copy into a new version**), which starts unverified and inactive.
- Each setting is verified separately, and only against a source of kind *official* attached to
  that version. Coaching sites, news and encyclopedias can be recorded as *secondary* for context
  but cannot verify anything. The overall label is *verified* (all ten settings), *partly
  verified* or *unverified*.
- Patterns for other years are separate rows. Nothing assumes the CAT 2024 pattern applies to
  another year: a previous-year paper is refused unless that year's pattern is recorded, and the
  mock page tells learners when the active pattern's year differs from the exam year in their
  profile.

## How to verify (or correct) the pattern

1. Download the Information Bulletin for the exam year from iimcat.ac.in.
2. Admin → Exam pattern → select the version → **Add a source**: kind *official*, the bulletin's
   title, publisher (the convening IIM), URL, the date you opened it, and the lines that state the
   pattern.
3. If every value matches, choose that source next to each setting and click **Verify**.
4. If any value differs, use **Copy into a new version** (same or a new year), correct the values
   while it is still a draft, add the bulletin as a source, verify the settings, then click
   **Use for new tests**. The old version stays attached to the tests built with it.

## Scoring rules covered by tests

`server/test/exam-config.test.ts` and `server/test/domain.test.ts` check, with real runs:

- +3 for a correct answer, −1 for a wrong MCQ, 0 for a wrong TITA, 0 when unanswered (version 1);
- a fixture version with different marks (+4/−2 MCQ, +2/−1 TITA) scores tests built after it was
  activated, while tests built before keep +3/−1/0;
- unopened sections score zero; each section runs on its own server-side clock, the test moves to
  the next section when time runs out, and submits itself after the last;
- secondary sources cannot verify a setting, verified or active versions cannot be edited, and
  only one version is active.
