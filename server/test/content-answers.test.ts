// Independent recomputation of every sample answer. If an answer key in the seed
// content is wrong, this test fails — the seed must never ship an unverified key.
import { describe, expect, it } from 'vitest';
import { SAMPLE_QA } from '../src/seed/content/sample-qa.js';
import { SAMPLE_VARC_DILR } from '../src/seed/content/sample-varc-dilr.js';

const all = [...SAMPLE_QA, ...SAMPLE_VARC_DILR];
const qs = all.filter((i): i is Extract<(typeof all)[number], { kind: 'question' }> => i.kind === 'question');
const byId = new Map(qs.map((q) => [q.externalId, q]));

/** Returns the value of the option with the given key, or the TITA answer. */
function keyed(id: string) {
  const q = byId.get(id)!;
  return q.type === 'MCQ' ? q.options![q.answer] : q.answer;
}
const num = (s: string) => {
  const frac = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  if (/^no change$/i.test(s.trim())) return 0;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
const C = (n: number, r: number) => fact(n) / (fact(r) * fact(n - r));
const powmod = (b: number, e: number, m: number) => {
  let r = 1;
  b %= m;
  while (e > 0) {
    if (e & 1) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1;
  }
  return r;
};

const computed: Record<string, number | string> = {
  'c100-qa-pct-001': 0,
  'c100-qa-pct-002': 59400 / (1.1 * 0.9 * 1.2),
  'c100-qa-pct-003': (() => {
    for (let n = 100; n < 1e6; n += 100) if (0.47 * n - (0.9 * n - 60 - 0.47 * n) === 1140) return n;
    return NaN;
  })(),
  'c100-qa-ratio-001': (700 * 15) / (8 + 12 + 15),
  'c100-qa-ratio-002': (() => {
    for (let k = 1; k < 100; k++) if (4 * (3 * k + 9) === 3 * (5 * k + 9)) return 5 * k;
    return NaN;
  })(),
  'c100-qa-avg-001': 10 * 24 - 9 * 23,
  'c100-qa-avg-002': (() => {
    for (let g = 0; g <= 27; g++) if (58 * (27 - g) + 67 * g === 62 * 27) return g;
    return NaN;
  })(),
  'c100-qa-pl-001': Math.round((1.4 * 0.85 - 1) * 100),
  'c100-qa-pl-002': 1200 / 1.2 + 1200 / 0.8 - 2400,
  'c100-qa-int-001': Math.round(5000 * 1.1 ** 2 - 5000 - 5000 * 0.1 * 2),
  'c100-qa-int-002': 5 * Math.log2(8),
  'c100-qa-mix-001': (0.7 * 20 - 0.4 * 20) / (0.4 - 0.3),
  'c100-qa-mix-002': 40 * 0.8 ** 3,
  'c100-qa-tsd-001': (2 * 60 * 40) / 100,
  'c100-qa-tsd-002': 400 / (5 - 3),
  'c100-qa-tsd-003': (() => {
    const a = 60;
    const b = a * Math.sqrt(9 / 16);
    const t = (9 * a) / b;
    return (a + b) * t;
  })(),
  'c100-qa-train-001': (150 + 250) / (72 * (5 / 18)),
  'c100-qa-boat-001': (30 / 2 - 30 / 3) / 2,
  'c100-qa-work-001': 1 / (1 / 12 + 1 / 18),
  'c100-qa-work-002': (1 - 6 * (1 / 20 + 1 / 30)) * 30,
  'c100-qa-pipe-001': 1 / (1 / 6 + 1 / 8 - 1 / 12),
  'c100-qa-part-001': (26000 * (30000 * 12)) / (30000 * 12 + 40000 * 6),
  'c100-qa-lin-001': (() => {
    for (let n = 0; n < 200; n++) for (let p = 0; p < 200; p++) if (3 * p + 2 * n === 130 && 2 * p + 3 * n === 145) return n;
    return NaN;
  })(),
  'c100-qa-quad-001': (() => {
    const r1 = (7 + 3) / 2;
    return r1 * (7 - r1);
  })(),
  'c100-qa-quad-002': Array.from({ length: 41 }, (_, i) => i - 20).filter((k) => k * k - 64 >= 0).length,
  'c100-qa-ineq-001': Math.min(...Array.from({ length: 10000 }, (_, i) => (i + 1) / 1000).map((x) => x + 9 / x)),
  'c100-qa-mod-001': Array.from({ length: 201 }, (_, i) => i - 100).filter((x) => Math.abs(x - 2) + Math.abs(x + 3) === 5).length,
  'c100-qa-log-001': [8, 16, 32, 64].find((x) => Math.abs(Math.log2(x) + Math.log(x) / Math.log(4) - 6) < 1e-9)!,
  'c100-qa-prog-001': Array.from({ length: 90 }, (_, i) => i + 10).filter((x) => x % 7 === 0).reduce((s, x) => s + x, 0),
  'c100-qa-prog-002': [0, 1, 2, 3, 4, 5].reduce((s, i) => s + 3 * 2 ** i, 0),
  'c100-qa-fact-001': Array.from({ length: 360 }, (_, i) => i + 1).filter((d) => 360 % d === 0).length,
  'c100-qa-rem-001': powmod(2, 100, 7),
  'c100-qa-units-001': powmod(7, 83, 10),
  'c100-qa-fct-001': Math.floor(125 / 5) + Math.floor(125 / 25) + Math.floor(125 / 125),
  'c100-qa-hcf-001': (() => {
    for (let x = 1; x < 1000; x++) if (gcd(72, x) === 12 && (72 * x) / gcd(72, x) === 360) return x;
    return NaN;
  })(),
  'c100-qa-tri-001': (() => {
    const s = 21;
    return Math.sqrt(s * (s - 13) * (s - 14) * (s - 15));
  })(),
  'c100-qa-circ-001': Math.sqrt(10 ** 2 - 8 ** 2),
  'c100-qa-coord-001': Math.abs(1 * (6 - 2) + 4 * (2 - 2) + 7 * (2 - 6)) / 2,
  'c100-qa-vol-001': ((4 / 3) * 6 ** 3) / 4 ** 2,
  'c100-qa-poly-001': (() => {
    const n = 360 / (180 - 150);
    return (n * (n - 3)) / 2;
  })(),
  'c100-qa-pnc-001': fact(5) / (fact(2) * fact(2)),
  'c100-qa-pnc-002': (() => {
    let n = 0;
    for (let a = 1; a < 10; a++) for (let b = 1; b < 10; b++) if (10 - a - b >= 1) n++;
    return n;
  })(),
  'c100-qa-prob-001': (() => {
    let n = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b === 8) n++;
    return n / 36;
  })(),
  'c100-qa-prob-002': 1 - 0.5 ** 4,
  'c100-qa-set-001': 60 + 50 - (100 - 20),
  'c100-qa-set-002': (() => {
    // brute-force minimum triple overlap over all region assignments (step 1)
    let best = Infinity;
    for (let x = 0; x <= 70; x++) {
      for (let mp = 0; mp + x <= 75; mp++) {
        const mc = 80 - x - mp; // assume nobody studies only Maths (minimises x)
        const pc = 75 - x - mp;
        if (mc < 0 || pc < 0 || 70 - x - mc - pc < 0) continue;
        const cOnly = 70 - x - mc - pc;
        if (x + mp + mc + pc + cOnly <= 100) best = Math.min(best, x);
      }
    }
    return best;
  })(),
  // DILR: computed from the table / brute force below
  'c100-di-rev-q1': 1.25 * (40 + 25 + 35 + 20) - (60 + 42 + 18),
  'c100-di-rev-q4': (35 + 28 + 42) / 3,
};

describe('sample QA and DI answers are independently correct', () => {
  for (const [id, value] of Object.entries(computed)) {
    it(id, () => {
      const q = byId.get(id);
      expect(q, `missing ${id}`).toBeDefined();
      const stated = keyed(id);
      const statedNum = num(stated);
      expect(Math.abs(statedNum - Number(value))).toBeLessThan(Math.max(1e-6, q!.tolerance ?? 0) + 1e-6);
    });
  }
  it('covers every QA sample question', () => {
    const qa = qs.filter((q) => q.section === 'QA').map((q) => q.externalId);
    expect(qa.filter((id) => !(id in computed))).toEqual([]);
  });
});

describe('DILR seating set (brute force over all 720 arrangements)', () => {
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  const valid = perms(['P', 'Q', 'R', 'S', 'T', 'U']).filter((a) => {
    const s = (p: string) => a.indexOf(p) + 1;
    return [1, 6].includes(s('P')) && s('Q') === s('R') + 1 && Math.abs(s('S') - s('T')) === 3 && ![1, 6].includes(s('U'));
  });
  it('q1: number of arrangements', () => expect(String(valid.length)).toBe(keyed('c100-lr-row-q1')));
  it('q2: U always next to P, and other options fail', () => {
    expect(valid.every((a) => Math.abs(a.indexOf('U') - a.indexOf('P')) === 1)).toBe(true);
    expect(valid.every((a) => a.indexOf('R') === 3)).toBe(false);
    expect(byId.get('c100-lr-row-q2')!.answer).toBe('A');
  });
  it('q3: seat 2 when S is left of P', () => {
    const sub = valid.filter((a) => a.indexOf('S') < a.indexOf('P'));
    expect(new Set(sub.map((a) => a[1])).size).toBe(1);
    expect(sub[0][1]).toBe(keyed('c100-lr-row-q3'));
  });
  it('q4: seat 3 when T is in seat 6', () => {
    const sub = valid.filter((a) => a[5] === 'T');
    expect(sub.length).toBe(1);
    expect(sub[0][2]).toBe(keyed('c100-lr-row-q4'));
  });
  it('DI q2/q3: growth leader and Q2 share', () => {
    const q1 = { W: 40, X: 25, Y: 35, Z: 20 };
    const q3 = { W: 60, X: 30, Y: 42, Z: 18 };
    const best = (Object.keys(q1) as (keyof typeof q1)[]).sort((a, b) => q3[b] / q1[b] - q3[a] / q1[a])[0];
    expect(keyed('c100-di-rev-q2')).toBe(best);
    expect(keyed('c100-di-rev-q3')).toBe(`${((50 / 130) * 100).toFixed(1)}%`);
  });
});

describe('sample content completeness', () => {
  it('every question has an answer, a solution with hints, and MCQ answers are valid options', () => {
    for (const q of qs) {
      expect(q.answer.trim(), q.externalId).not.toBe('');
      expect(q.solution?.learn, q.externalId).toBeTruthy();
      expect(q.solution?.hints?.length, q.externalId).toBeGreaterThan(0);
      if (q.type === 'MCQ') {
        expect(Object.keys(q.options!)).toContain(q.answer);
        for (const k of Object.keys(q.options!)) if (k !== q.answer) expect(q.solution!.distractors?.[k], `${q.externalId} ${k}`).toBeTruthy();
      }
    }
  });
  it('no sample is labelled as an authentic PYQ or carries a year/slot', () => {
    for (const item of all) {
      expect(item.origin).toBe('original_practice');
      expect((item as any).examYear).toBeUndefined();
      expect((item as any).examSlot).toBeUndefined();
    }
  });
});
