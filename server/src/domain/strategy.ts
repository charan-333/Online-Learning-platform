/**
 * Strategy drill evaluation: choose which questions to attempt under a time budget
 * to maximise expected score. The optimum is a 0/1 knapsack over expected value
 * (EV = p·marksCorrect + (1−p)·marksWrong) with expected solving time as weight;
 * negative-EV questions are never worth attempting.
 */
export interface DrillItem {
  id: string;
  ev: number;
  timeSec: number;
}

export function optimalSelection(items: DrillItem[], budgetSec: number, stepSec = 15): { ids: string[]; ev: number; timeSec: number } {
  const cap = Math.floor(budgetSec / stepSec);
  const usable = items.filter((i) => i.ev > 0);
  const w = usable.map((i) => Math.max(1, Math.ceil(i.timeSec / stepSec)));
  const dp: number[] = new Array(cap + 1).fill(0);
  const take: boolean[][] = usable.map(() => new Array(cap + 1).fill(false));
  usable.forEach((it, i) => {
    for (let c = cap; c >= w[i]; c--) {
      const v = dp[c - w[i]] + it.ev;
      if (v > dp[c] + 1e-9) {
        dp[c] = v;
        take[i][c] = true;
      }
    }
  });
  const ids: string[] = [];
  let c = cap;
  for (let i = usable.length - 1; i >= 0; i--) {
    if (take[i][c]) {
      ids.push(usable[i].id);
      c -= w[i];
    }
  }
  const chosen = usable.filter((u) => ids.includes(u.id));
  return { ids, ev: Math.round(chosen.reduce((s, x) => s + x.ev, 0) * 100) / 100, timeSec: chosen.reduce((s, x) => s + x.timeSec, 0) };
}

export function evaluateChoice(items: DrillItem[], chosen: string[], budgetSec: number) {
  const picked = items.filter((i) => chosen.includes(i.id));
  const time = picked.reduce((s, i) => s + i.timeSec, 0);
  // If the plan overruns the budget, only the questions that fit (in chosen order) count.
  let used = 0;
  let ev = 0;
  const counted: string[] = [];
  for (const id of chosen) {
    const it = items.find((i) => i.id === id);
    if (!it) continue;
    if (used + it.timeSec > budgetSec) break;
    used += it.timeSec;
    ev += it.ev;
    counted.push(id);
  }
  const best = optimalSelection(items, budgetSec);
  return {
    chosenEv: Math.round(ev * 100) / 100,
    chosenTimeSec: time,
    overBudget: time > budgetSec,
    counted,
    negativeEvChosen: picked.filter((p) => p.ev <= 0).map((p) => p.id),
    optimal: best,
    efficiency: best.ev > 0 ? Math.round((ev / best.ev) * 100) : 100,
  };
}
