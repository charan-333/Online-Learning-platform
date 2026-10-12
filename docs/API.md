# CAT 100 REST API

All endpoints are under `/api`, take and return JSON, and use the session cookie set at sign-in.
Every non-GET request from a signed-in client must send `x-csrf-token` (returned by login, register
and `GET /api/auth/me`). Errors use one envelope: `{ "error": { "code", "message", "details?" } }`.
Learner endpoints only ever read or change the signed-in user's own data.

## Auth (`/api/auth`)
| Method | Path | Notes |
|---|---|---|
| POST | /register | `{email, password (≥10), displayName}` → signs in |
| POST | /login | `{email, password}` → `{user, csrfToken}` |
| POST | /logout | ends the session |
| POST | /forgot-password | `{email}`; same response whether or not the account exists |
| POST | /reset-password | `{token, password}`; signs out all sessions |
| GET | /me | `{user, profile, csrfToken}` |

## Profile, account, notes (`/api`)
| Method | Path | Notes |
|---|---|---|
| GET/PATCH | /profile | availability, self-ratings, exam year/date, mode, low-time mode, gamification |
| GET | /exam-configs | exam pattern(s) with sections and marking, incl. verification status |
| GET | /recommendations | top topics with reasons |
| GET | /bookmarks | |
| GET/POST | /notes | `?q=` search; body `{body, kind: note|annotation|highlight|workspace, questionId|topicId|passageId|dilrSetId, anchor?}` |
| PATCH/DELETE | /notes/:id | |
| GET | /errors | filters `status, category, section, topic, q, page, pageSize` |
| PATCH | /errors/:id | `{category?, rootCause?, correctApproach?}` |
| GET | /errors/trends | weekly counts, per-category trend and recurrence |
| GET/POST | /study-sessions, PATCH /study-sessions/:id | consistency and streak data |
| GET | /account/export | all learner data as JSON |
| DELETE | /account | `{password, confirm: "DELETE"}` |

## Syllabus and content
| Method | Path | Notes |
|---|---|---|
| GET | /sections | with the learner's average mastery |
| GET | /topics | `?section=`; mastery state, question and PYQ counts, prerequisites |
| GET | /topics/:id | concept, traps, formulas, worked examples, counts, mastery, notes |
| GET | /topics/:id/prerequisites | transitive chain with mastery |
| GET | /topics/:id/progress | per-difficulty accuracy and recent attempts |
| GET | /passages, /passages/:id | analysis unlocks after all questions answered or `?reveal=true` |
| GET | /dilr-sets, /dilr-sets/:id | same unlocking for the deduction walkthrough |
| GET | /formulas | `?q=&topic=&section=` |

## Questions (`/api/questions`)
| Method | Path | Notes |
|---|---|---|
| GET | / | filters: `q, section, topic, subtopic, difficulty, type, origin, year, slot, sourceVerification, attempted, result, previouslyIncorrect, bookmarked, mastery, minTimeSec, maxTimeSec, sort, page, pageSize` (lists accept comma-separated values) |
| GET | /facets | years/slots and origin counts |
| GET | /:id | question without answer or solution |
| GET | /:id/hints | `?count=n` progressive hints |
| GET | /:id/solution | after an attempt, or `?reveal=true` (recorded; later attempts don't count toward mastery); locked while the question is in an unsubmitted test |
| POST | /:id/attempts | `{answer, timeTakenSec, confidence?, guessed?, timed?, hintsUsed?, mistakeType?, context?, contextId?}` → correctness, correct answer, error-log id, updated mastery |
| PATCH | /attempts/:attemptId | post-answer reflection `{understood?, mistakeType?, confidence?}` |
| GET | /:id/history | the learner's attempts |
| POST/DELETE | /:id/bookmark | |

## Lessons, revision, plans, diagnostic
| Method | Path | Notes |
|---|---|---|
| GET | /lessons/daily | `?minutes=&date=&topic=`; one lesson per day and length |
| GET | /lessons, /lessons/:id | |
| POST | /lessons/:id/progress | `{blockKey}`; practice blocks require every question answered; the final block writes the report |
| GET | /revision/due, /revision/upcoming | |
| POST | /revision/:id/review | `{grade: 0..3}` |
| POST | /revision/items | `{itemType: formula|topic|question, refId}` |
| GET | /plans/current | re-flows missed tasks, returns tasks and totals |
| POST | /plans/generate | builds a new active plan |
| PATCH | /plans/:id | `{action: "reallocate"}` or `{taskId, status?, scheduledDate?}` |
| GET | /plans/history, /plans/today | |
| GET | /diagnostic | fixed diagnostic set |
| POST | /diagnostic/submit | `{responses: [{questionId, answer, timeTakenSec, confidence?}]}` → per-section results, mode, plan |

## Mock tests (`/api/mocks`)
| Method | Path | Notes |
|---|---|---|
| GET | / | available tests and the learner's attempts |
| POST | / | `{kind: full|sectional|topic|custom|pyq_paper|error_test|drill, sections?, topics?, difficulty?, origin?, year?, slot?, questionCount?, durationMin?}` |
| POST | /:id/start | starts or resumes (one open attempt per test) |
| GET | /attempts/:attemptId | state with server clock; applies timeouts |
| PUT | /attempts/:attemptId/responses/:questionId | `{answer?, flagged?, timeSpentSec?}` autosave |
| POST | /attempts/:attemptId/next-section | sectional-lock tests |
| POST | /attempts/:attemptId/submit | idempotent |
| GET | /attempts/:attemptId/analysis | totals, sections, per-question classification, recommendations, follow-up; `percentile: null` |

## Analytics, tutor, strategy, search
| Method | Path | Notes |
|---|---|---|
| GET | /analytics/overview, /analytics/topics, /analytics/errors | |
| GET | /tutor/status | provider and daily usage |
| GET/POST | /tutor/sessions | `{contextType: general|topic|question|mock|error, contextId?, title?}` |
| GET | /tutor/sessions/:id | with messages |
| POST | /tutor/sessions/:id/messages | `{content}` → reply with provider and grounding |
| POST | /strategy/drills | `{section, count}` |
| POST | /strategy/drills/:id/submit | `{chosen: [questionId...]}` |
| GET | /strategy/drills | |
| GET | /search | `?q=` across questions, topics, seen solutions, formulas, notes, bookmarks, errors, tests, lessons |

## Admin (`/api/admin`, admin role only)
| Method | Path | Notes |
|---|---|---|
| POST | /questions/import | `{items, dryRun?, publish?, filename?}` → import job with issues |
| GET | /import-jobs, /import-jobs/:id | |
| GET | /questions, /questions/:id | filters `status, origin, sourceVerification, solutionVerification, q`; detail has versions and audit |
| PATCH | /questions/:id | edit; snapshots a version |
| POST | /questions/:id/verify | `{source?, solution?, sourceRef?, note?}` |
| POST | /questions/:id/status | `{status: draft|published|unpublished}`; PYQs need a verified source |
| GET | /questions/:id/versions/:versionId | snapshot |
| GET | /audit, /quality | |
| PUT | /exam-configs | upsert a year's pattern |
| POST | /uploads | `{filename, dataBase64}` PNG/JPEG/WebP ≤ 2 MB → markdown snippet |
