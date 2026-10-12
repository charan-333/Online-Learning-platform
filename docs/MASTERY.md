# Mastery, revision and planning rules

All numbers below live in configuration objects in `server/src/domain/` and are covered by
unit tests in `server/test/domain.test.ts`. Change them there; nothing else hard-codes them.

## Topic mastery score (`MASTERY_CONFIG`, `domain/mastery.ts`)

```
score = 100 × E × (0.7·A + 0.2·S + 0.1·C)          (0–100, two decimals)
```

Only the latest 30 attempts in a topic are used. Attempts made after the learner revealed
the solution (including a worked example shown in a daily lesson) are excluded entirely.

| Term | Meaning |
|---|---|
| A, accuracy | Weighted share correct. Weight = 0.5^(age in days / 21) × difficulty weight (easy 0.6, medium 1.0, difficult 1.3, advanced 1.5). A correct answer marked "guessed" earns 0.5. |
| S, speed | Mean over correct attempts of min(1, target time ÷ time taken). |
| C, calibration | 1 − (wrong answers given with high confidence ÷ counted attempts). |
| E, evidence | min(1, distinct questions ÷ 8). A few lucky answers cannot produce mastery. |

## States (checked in this order)

1. **not_started**: no counted attempts.
2. **learning**: fewer than 3 distinct questions.
3. **weak**: accuracy on the last 5 attempts < 50 %, or one mistake type appears ≥ 2 times among those 5.
4. **exam_ready**: score ≥ 85, ≥ 10 distinct questions, ≥ 3 difficult/advanced correct (not guessed), ≥ 3 timed correct within target time.
5. **proficient**: score ≥ 70 and ≥ 6 distinct questions.
6. **practicing**: otherwise.
7. **revision_due** replaces proficient/exam_ready if the topic was last practised more than 21 days ago.

Mode **B** (high-performance practice) when score ≥ 70 and state ≠ weak; otherwise mode **A** (foundation).
Every state change stores a plain-language `state_reason`, shown on the topic page.

## Recommendations (`services/recommend.ts`)

Topics are ranked by state priority (weak > revision due > learning > practicing > not started > proficient),
then adjusted for open error-log entries, the section least practised in the last 7 days, diagnostic
weakness and whether the topic has any published questions. A topic whose prerequisite has mastery < 40 is
replaced by that prerequisite, and the recommendation says so. Each recommendation lists its reasons.

## Spaced revision (`SRS_CONFIG`, `domain/srs.ts`)

Simplified SM-2 with four grades (0 forgot, 1 hard, 2 good, 3 easy).

- Items enter the queue with an initial delay by reason: wrong answer 1 day, guess or low confidence
  2 days, high-value formula 3 days, anything else added by the learner 4 days. Re-adding never
  duplicates; it only pulls the due date forward.
- On review: forgot → interval 1 day, repetitions reset, lapses +1, ease −0.2. Otherwise the first
  successful review uses hard 1 d, good 3 d, easy 5 d; later ones use hard → interval × 1.2 (ease −0.15),
  good → interval × ease, easy → interval × ease × 1.3 (ease +0.15). Ease stays within [1.3, 3.0].
- Intervals never exceed 120 days or the days left before the exam date.
- Items recalled as good/easy at an interval ≥ 60 days are retired from the active queue.
- In a daily lesson revision may take at most 35 % of the session.

## Error log

A wrong answer opens (or updates) one open entry per question with the learner's answer, the correct
answer, a category (one of 12) and a remediation topic. A later correct, non-revealed answer resolves it.
Categories and remedies: `domain/errors.ts`.

## Study plan (`PLAN_CONFIG`, `domain/planner.ts`)

- Capacity per date: 0 on off days, weekend minutes on weekend days, workday minutes otherwise, 20 in
  low-time mode. Minimum useful session: 20 minutes.
- 15 % of each study day (≥ 5 min) is a revision slot.
- From week 2, one mock per week (full 120 min on a weekend day with enough time, otherwise a 40-minute
  sectional) plus a review task on the next study day.
- Topics are queued by prerequisite order and recommendation priority, interleaved across sections, with
  workload = estimated hours × factor by state (not started/weak 100 %, learning 90 %, practising 60 %,
  revision due 40 %, proficient 25 %, exam-ready 0 %), split into learn (first 40 %) and practice tasks.
- Reallocation moves pending tasks from past dates forward in order into free capacity. Rows are moved,
  not copied, so nothing is duplicated; overdue revision slots are dropped because the revision queue
  already carries that work. It runs whenever the plan is opened.

## Mock analysis (`ANALYSIS_CONFIG`, `domain/mockAnalysis.ts`)

Each question is classified (`classify`):

- correct: **correct but slow** if time > 1.25 × target, else **correct and efficient**;
- wrong: **attempted despite low expected value** if it was difficult/advanced with negative EV;
  else **incorrect due to careless execution** if answered in < 40 % of target time; else
  **incorrect due to a conceptual gap** if topic mastery < 40; else **incorrect despite adequate time**;
- unanswered: **skipped despite sufficient ability** if easy/medium with topic mastery ≥ 60, else
  **skipped appropriately**.

Success probability p shrinks the learner's topic accuracy toward a difficulty prior (easy 0.85,
medium 0.65, difficult 0.45, advanced 0.30; strength 5 pseudo-attempts) and scales by difficulty
relative to medium, clamped to [0.02, 0.98]. Expected value = p × marks for correct + (1 − p) × marks
for wrong (0 for TITA). Strategy drills use the same p and pick the optimum with a 0/1 knapsack.

Recommendations carry a metric and a baseline and are checked again after the next test of the same
kind. **No percentile is ever estimated**: there is no calibrated data to map scores to percentiles.
