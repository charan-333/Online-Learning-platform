// CAT 100 syllabus tree. Topic relevance follows the publicly described CAT section
// structure (VARC, DILR, QA). It is configurable data: admins can edit it, and no
// topic is claimed to be guaranteed to appear in any exam.

export interface TopicSeed {
  id: string;
  area: string;
  name: string;
  summary: string;
  prereqs?: string[];
  subtopics?: string[];
  concept?: string;
  traps?: string;
  revision?: string;
  hours?: number;
}

export interface SectionSeed {
  id: 'VARC' | 'DILR' | 'QA';
  name: string;
  position: number;
  topics: TopicSeed[];
}

const QA: TopicSeed[] = [
  // ------------------------------------------------------------ Arithmetic
  {
    id: 'qa-percentages',
    area: 'Arithmetic',
    name: 'Percentages',
    summary: 'Percent as a fraction of a base, successive change, and percentage-point vs percent change.',
    subtopics: ['Percentage change', 'Successive change', 'Base effects', 'Fraction–percent equivalents'],
    hours: 4,
    concept: `A percentage is a ratio with denominator 100: $x\\% = \\frac{x}{100}$. Every percentage question is really asking **"percent of what base?"**

**Percentage change** $= \\frac{\\text{new} - \\text{old}}{\\text{old}} \\times 100$. The base is always the *old* value.

**Successive change.** Changes of $a\\%$ then $b\\%$ multiply: $(1+\\tfrac{a}{100})(1+\\tfrac{b}{100})$. The net change is $a + b + \\frac{ab}{100}$ percent (use negative values for decreases).

**Fraction equivalents** speed up calculation: $\\frac{1}{8}=12.5\\%$, $\\frac{1}{6}=16.67\\%$, $\\frac{1}{7}\\approx14.29\\%$, $\\frac{1}{9}\\approx11.11\\%$, $\\frac{1}{11}\\approx9.09\\%$.

**Reverse problems.** If $A$ is $r\\%$ more than $B$, then $B$ is $\\frac{r}{100+r}\\times100\\%$ less than $A$.`,
    traps: `- Using the new value as the base for percentage change.
- Adding successive percentages ($+20\\%$ then $-20\\%$ is a $4\\%$ **loss**, not zero).
- Confusing percentage points with percent: 10% → 12% is +2 percentage points but +20%.`,
    revision: 'Net of successive changes: $a+b+ab/100$. Reverse: $r/(100+r)$. Memorise $1/n$ for $n \\le 12$.',
  },
  {
    id: 'qa-ratio-proportion',
    area: 'Arithmetic',
    name: 'Ratio and proportion',
    summary: 'Ratios as parts of a whole, combining ratios, proportion and variation.',
    prereqs: ['qa-percentages'],
    subtopics: ['Combining ratios', 'Direct and inverse variation', 'Componendo–dividendo'],
    hours: 3,
    concept: `A ratio $a:b$ means the quantities are $ak$ and $bk$ for some positive $k$. Introducing $k$ turns ratio problems into ordinary algebra.

**Combining ratios.** If $A:B = 2:3$ and $B:C = 4:5$, scale so $B$ matches: $A:B:C = 8:12:15$.

**Variation.** $y \\propto x$ means $y = kx$; $y \\propto \\frac1x$ means $xy = k$. Joint variation multiplies these.

**Componendo–dividendo.** If $\\frac ab = \\frac cd$ then $\\frac{a+b}{a-b} = \\frac{c+d}{c-d}$.`,
    traps: `- Adding ratios directly ($2:3$ plus $1:4$ is meaningless without the totals).
- Forgetting that "ratio of A to B changes" usually means only one quantity changed.`,
  },
  {
    id: 'qa-averages',
    area: 'Arithmetic',
    name: 'Averages and weighted averages',
    summary: 'Mean as a balance point; weighted averages and the deviation method.',
    prereqs: ['qa-ratio-proportion'],
    subtopics: ['Deviation method', 'Weighted average', 'Change in average on adding/removing items'],
    hours: 3,
    concept: `Average $= \\frac{\\text{sum}}{\\text{count}}$, so **sum = average × count** is the workhorse identity.

**Deviation method.** Pick a convenient reference value; the average is the reference plus the mean of the deviations.

**Weighted average.** $\\bar x = \\frac{w_1x_1 + w_2x_2}{w_1+w_2}$. Equivalently, the weights are inversely proportional to the distances from the mean: $\\frac{w_1}{w_2} = \\frac{x_2 - \\bar x}{\\bar x - x_1}$. This is the same idea as alligation.

When one item is added and the average rises by $d$ over $n$ items, the new item is $\\text{old average} + (n+1)d$.`,
    traps: `- Averaging averages of groups with different sizes without weights.
- Losing track of whether the count includes the new member.`,
  },
  {
    id: 'qa-profit-loss',
    area: 'Arithmetic',
    name: 'Profit, loss, and discount',
    summary: 'Cost, marked and selling price relationships and successive discounts.',
    prereqs: ['qa-percentages'],
    hours: 3,
    concept: `Profit % is on **cost price**: $\\frac{SP - CP}{CP}\\times100$. Discount % is on **marked price**: $\\frac{MP - SP}{MP}\\times100$.

Chain the multipliers: $SP = MP(1 - d) = CP(1 + p)$, so $\\frac{MP}{CP} = \\frac{1+p}{1-d}$.

Successive discounts $d_1, d_2$ act like successive percentage changes: net discount $= d_1 + d_2 - \\frac{d_1d_2}{100}$.

**False weights.** A trader who uses a 900 g weight for 1 kg gains $\\frac{100}{900}\\times100 = 11.1\\%$ on cost.`,
    traps: `- Computing profit on selling price.
- Treating "20% + 10% discount" as 30%.`,
  },
  {
    id: 'qa-interest',
    area: 'Arithmetic',
    name: 'Simple and compound interest',
    summary: 'Linear vs multiplicative growth, compounding periods, and the CI–SI difference.',
    prereqs: ['qa-percentages'],
    hours: 2.5,
    concept: `**Simple interest:** $SI = \\frac{PRT}{100}$; the amount grows linearly.

**Compound interest:** $A = P\\left(1+\\frac{R}{100}\\right)^T$; the amount grows geometrically. For compounding $n$ times a year use $R/n$ per period and $nT$ periods.

**Two-year difference:** $CI - SI = P\\left(\\frac{R}{100}\\right)^2$. Three-year: $P\\left(\\frac{R}{100}\\right)^2\\left(3 + \\frac{R}{100}\\right)$.

Instalment problems: each instalment's present value is $\\frac{x}{(1+r)^k}$; the sum equals the principal.`,
    traps: '- Applying the annual rate per half-year without halving it.\n- Using the 2-year CI–SI formula for 3 years.',
  },
  {
    id: 'qa-mixtures',
    area: 'Arithmetic',
    name: 'Mixtures and alligation',
    summary: 'Weighted averages applied to mixtures; repeated replacement.',
    prereqs: ['qa-averages'],
    hours: 2.5,
    concept: `**Alligation** is the weighted-average rule: mixing qualities $c_1 < m < c_2$ needs quantities in the ratio $\\frac{q_1}{q_2} = \\frac{c_2 - m}{m - c_1}$.

**Repeated replacement.** From a vessel of volume $V$ containing pure liquid, remove $x$ and replace with water $n$ times. The remaining pure liquid is $V\\left(1 - \\frac xV\\right)^n$.`,
    traps: '- Applying alligation to quantities that are not averaged over the same base (e.g. mixing by weight using per-litre prices).',
  },
  {
    id: 'qa-tsd',
    area: 'Arithmetic',
    name: 'Time, speed, and distance',
    summary: 'Distance = speed × time; relative speed; average speed.',
    prereqs: ['qa-ratio-proportion'],
    subtopics: ['Relative speed', 'Average speed', 'Races and circular tracks'],
    hours: 4,
    concept: `$D = S\\times T$. If one of the three is fixed, the other two are directly or inversely proportional: for fixed distance, $S \\propto \\frac1T$.

**Average speed** is total distance over total time. For equal distances at $a$ and $b$: $\\frac{2ab}{a+b}$ (harmonic mean), not $\\frac{a+b}{2}$.

**Relative speed.** Same direction: $|a - b|$; opposite direction: $a + b$.

**Circular track** of length $L$: two runners first meet after $\\frac{L}{\\text{relative speed}}$.

Unit conversion: $1\\text{ km/h} = \\frac{5}{18}\\text{ m/s}$.`,
    traps: '- Averaging speeds arithmetically.\n- Mixing km/h with metres and seconds.',
  },
  {
    id: 'qa-trains-boats',
    area: 'Arithmetic',
    name: 'Trains, boats, and streams',
    summary: 'Relative motion with lengths (trains) and with a current (boats).',
    prereqs: ['qa-tsd'],
    hours: 2,
    concept: `A train crossing a pole covers its own length; crossing a platform or another train covers the **sum of lengths**, at the relevant relative speed.

Boat speed in still water $b$, stream $s$: downstream $b+s$, upstream $b-s$. So $b = \\frac{d+u}{2}$, $s = \\frac{d-u}{2}$.`,
    traps: '- Forgetting to add the platform length.\n- Using still-water speed for upstream travel.',
  },
  {
    id: 'qa-time-work',
    area: 'Arithmetic',
    name: 'Time and work',
    summary: 'Work rates, combined work, and efficiency.',
    prereqs: ['qa-ratio-proportion'],
    hours: 3,
    concept: `Think in **rates**: if A finishes a job in $a$ days, A does $\\frac1a$ of it per day. Rates add when people work together: $\\frac1a + \\frac1b$.

Using the LCM of the days as total work units avoids fractions: for 12 and 18 days take 36 units; rates are 3 and 2 units/day; together 5 units/day → 7.2 days.

Man-days: $\\frac{M_1D_1H_1}{W_1} = \\frac{M_2D_2H_2}{W_2}$.`,
    traps: '- Adding days instead of rates.\n- Ignoring that someone left partway through.',
  },
  {
    id: 'qa-pipes',
    area: 'Arithmetic',
    name: 'Pipes and cisterns',
    summary: 'Time and work with negative (draining) rates.',
    prereqs: ['qa-time-work'],
    hours: 1.5,
    concept: 'Pipes are workers; an outlet has a negative rate. Net rate $= \\sum \\frac{1}{\\text{fill times}} - \\sum \\frac{1}{\\text{empty times}}$.',
    traps: '- Forgetting that a leak works the whole time, including while the tank is partly full.',
  },
  {
    id: 'qa-partnership',
    area: 'Arithmetic',
    name: 'Partnership',
    summary: 'Profit sharing in proportion to capital × time.',
    prereqs: ['qa-ratio-proportion'],
    hours: 1,
    concept: 'Profit is shared in the ratio of $\\text{capital} \\times \\text{time}$ for each partner. A working partner\'s salary is paid first, then the remainder is shared.',
  },
  {
    id: 'qa-arithmetic-applications',
    area: 'Arithmetic',
    name: 'Applications of arithmetic',
    summary: 'Mixed word problems combining several arithmetic ideas.',
    prereqs: ['qa-percentages', 'qa-ratio-proportion', 'qa-tsd', 'qa-time-work'],
    hours: 3,
    concept: 'Multi-concept word problems. Translate every sentence into an equation or ratio before calculating, name one variable per unknown, and check the answer against every condition in the stem.',
  },
  // ------------------------------------------------------------ Algebra
  {
    id: 'qa-linear-equations',
    area: 'Algebra',
    name: 'Linear equations',
    summary: 'Forming and solving linear equations in one and two variables.',
    hours: 2,
    concept: 'Translate words into equations, one variable per unknown. A system $a_1x+b_1y=c_1$, $a_2x+b_2y=c_2$ has a unique solution when $\\frac{a_1}{a_2} \\neq \\frac{b_1}{b_2}$, none when the ratios of $x$, $y$ coefficients match but constants do not, and infinitely many when all three ratios match.',
  },
  {
    id: 'qa-simultaneous-equations',
    area: 'Algebra',
    name: 'Simultaneous equations',
    summary: 'Systems of equations and integer-solution counting.',
    prereqs: ['qa-linear-equations'],
    hours: 2,
    concept: 'Eliminate variables systematically. For integer solutions of $ax + by = c$, find one solution, then the general solution steps by $\\frac{b}{g}$ in $x$ and $\\frac{a}{g}$ in $y$, where $g = \\gcd(a,b)$.',
  },
  {
    id: 'qa-quadratics',
    area: 'Algebra',
    name: 'Quadratic equations',
    summary: 'Roots, discriminant, and relations between roots and coefficients.',
    prereqs: ['qa-linear-equations', 'qa-identities'],
    hours: 3,
    concept: `For $ax^2 + bx + c = 0$: roots $\\frac{-b \\pm \\sqrt{D}}{2a}$ with $D = b^2 - 4ac$.

- $D > 0$: two distinct real roots; $D = 0$: equal roots; $D < 0$: no real roots.
- Sum of roots $= -\\frac ba$, product $= \\frac ca$.
- If coefficients are rational and $D$ is not a perfect square, irrational roots come in conjugate pairs.`,
    traps: '- Dividing both sides by a variable that may be zero, losing a root.\n- Forgetting to check that roots satisfy domain constraints (e.g. lengths must be positive).',
  },
  {
    id: 'qa-polynomials',
    area: 'Algebra',
    name: 'Polynomials',
    summary: 'Remainder and factor theorems, Vieta relations for higher degree.',
    prereqs: ['qa-quadratics'],
    hours: 2,
    concept: '**Remainder theorem:** $p(x)$ divided by $(x-a)$ leaves $p(a)$. **Factor theorem:** $(x-a)$ is a factor iff $p(a)=0$. For a cubic $ax^3+bx^2+cx+d$, sum of roots $=-b/a$, sum of pairwise products $=c/a$, product $=-d/a$.',
  },
  {
    id: 'qa-identities',
    area: 'Algebra',
    name: 'Algebraic identities',
    summary: 'Standard expansions and factorisations.',
    prereqs: ['qa-linear-equations'],
    hours: 1.5,
    concept: '$(a\\pm b)^2 = a^2 \\pm 2ab + b^2$, $a^2 - b^2 = (a-b)(a+b)$, $a^3 \\pm b^3 = (a\\pm b)(a^2 \\mp ab + b^2)$, and $a^3+b^3+c^3-3abc = (a+b+c)(a^2+b^2+c^2-ab-bc-ca)$, so if $a+b+c=0$ then $a^3+b^3+c^3 = 3abc$.',
  },
  {
    id: 'qa-inequalities',
    area: 'Algebra',
    name: 'Inequalities',
    summary: 'Linear and quadratic inequalities, AM–GM.',
    prereqs: ['qa-quadratics'],
    hours: 3,
    concept: `Multiplying or dividing by a negative number reverses the inequality. For quadratic inequalities, find the roots and test signs on each interval.

**AM ≥ GM** for non-negative numbers: $\\frac{a+b}{2} \\ge \\sqrt{ab}$, with equality iff $a=b$. Useful for maximising a product with a fixed sum, or minimising a sum with a fixed product.`,
    traps: '- Multiplying by an expression whose sign is unknown.\n- Applying AM–GM to negative numbers.',
  },
  {
    id: 'qa-modulus',
    area: 'Algebra',
    name: 'Modulus',
    summary: 'Absolute value as distance; case-splitting.',
    prereqs: ['qa-inequalities'],
    hours: 2,
    concept: '$|x - a|$ is the distance between $x$ and $a$ on the number line. $|x| < k \\iff -k < x < k$; $|x| > k \\iff x < -k$ or $x > k$. For sums of moduli, split at each critical point and solve piece by piece; the graph of $|x-a|+|x-b|$ is flat between $a$ and $b$.',
  },
  {
    id: 'qa-functions',
    area: 'Algebra',
    name: 'Functions',
    summary: 'Domain, range, composition, and functional equations.',
    prereqs: ['qa-inequalities'],
    hours: 2.5,
    concept: 'A function assigns one output to each input. Know domain restrictions (denominators ≠ 0, even roots of non-negatives, log arguments > 0). For $f(g(x))$, apply $g$ first. In functional equations, substitute convenient values (0, 1, $-x$, $\\frac1x$) to generate solvable equations.',
  },
  {
    id: 'qa-graphs',
    area: 'Algebra',
    name: 'Graphs',
    summary: 'Graph transformations and reading regions.',
    prereqs: ['qa-functions', 'qa-coordinate-geometry'],
    hours: 2,
    concept: '$f(x) + c$ shifts up; $f(x - c)$ shifts right; $-f(x)$ reflects in the x-axis; $f(-x)$ reflects in the y-axis; $|f(x)|$ folds negative parts up. Regions such as $|x| + |y| \\le k$ are squares rotated 45° with area $2k^2$.',
  },
  {
    id: 'qa-exponents-logs',
    area: 'Algebra',
    name: 'Exponents and logarithms',
    summary: 'Laws of exponents and logarithms, change of base.',
    prereqs: ['qa-identities'],
    hours: 2.5,
    concept: '$a^m a^n = a^{m+n}$, $(a^m)^n = a^{mn}$. $\\log_a(xy) = \\log_a x + \\log_a y$, $\\log_a x^k = k\\log_a x$, $\\log_a b = \\frac{\\log b}{\\log a}$. A log is defined only for positive arguments and a positive base $\\neq 1$.',
    traps: '- Forgetting the domain check after solving a log equation.',
  },
  {
    id: 'qa-sequences-series',
    area: 'Algebra',
    name: 'Sequences and series',
    summary: 'Patterns, sums, and telescoping series.',
    prereqs: ['qa-progressions'],
    hours: 2.5,
    concept: 'Standard sums: $\\sum k = \\frac{n(n+1)}{2}$, $\\sum k^2 = \\frac{n(n+1)(2n+1)}{6}$, $\\sum k^3 = \\left(\\frac{n(n+1)}{2}\\right)^2$. Telescoping: write the term as a difference $f(k) - f(k+1)$, e.g. $\\frac{1}{k(k+1)} = \\frac1k - \\frac1{k+1}$.',
  },
  {
    id: 'qa-progressions',
    area: 'Algebra',
    name: 'Arithmetic and geometric progressions',
    summary: 'nth term and sums of AP and GP.',
    prereqs: ['qa-linear-equations'],
    hours: 2.5,
    concept: `**AP:** $a_n = a + (n-1)d$, $S_n = \\frac n2(2a + (n-1)d) = \\frac n2(\\text{first} + \\text{last})$.

**GP:** $a_n = ar^{n-1}$, $S_n = a\\frac{r^n - 1}{r - 1}$; for $|r|<1$, $S_\\infty = \\frac{a}{1-r}$.

Three numbers in AP: $a-d, a, a+d$. In GP: $\\frac ar, a, ar$.`,
  },
  {
    id: 'qa-algebra-optimization',
    area: 'Algebra',
    name: 'Optimization and equation-based problems',
    summary: 'Maxima/minima using algebra, AM–GM, and integer constraints.',
    prereqs: ['qa-inequalities', 'qa-quadratics'],
    hours: 2,
    concept: 'A quadratic $ax^2+bx+c$ with $a>0$ is minimised at $x = -\\frac{b}{2a}$. With integer constraints, test the integers nearest the real optimum. Use AM–GM for products with a fixed sum.',
  },
  // ------------------------------------------------------------ Number systems
  {
    id: 'qa-divisibility',
    area: 'Number Systems',
    name: 'Divisibility',
    summary: 'Divisibility rules and their proofs.',
    hours: 1.5,
    concept: 'By 3 or 9: digit sum. By 4: last two digits; by 8: last three. By 11: alternating digit sum divisible by 11. By 7, 11, 13: $1001 = 7 \\times 11 \\times 13$, so split into 3-digit blocks with alternating signs.',
  },
  {
    id: 'qa-factors',
    area: 'Number Systems',
    name: 'Factors and multiples',
    summary: 'Counting factors, sum of factors, and factor pairs.',
    prereqs: ['qa-primes'],
    hours: 2,
    concept: 'If $N = p^a q^b r^c$, the number of factors is $(a+1)(b+1)(c+1)$ and the sum of factors is $\\frac{p^{a+1}-1}{p-1}\\cdot\\frac{q^{b+1}-1}{q-1}\\cdots$. $N$ has an odd number of factors iff it is a perfect square.',
  },
  {
    id: 'qa-hcf-lcm',
    area: 'Number Systems',
    name: 'HCF and LCM',
    summary: 'GCD and LCM via prime factorisation and the Euclidean algorithm.',
    prereqs: ['qa-factors'],
    hours: 1.5,
    concept: 'HCF takes the minimum power of each prime; LCM the maximum. $\\text{HCF}(a,b) \\times \\text{LCM}(a,b) = ab$ (for two numbers only). For fractions: HCF = HCF(numerators)/LCM(denominators).',
  },
  {
    id: 'qa-primes',
    area: 'Number Systems',
    name: 'Prime numbers',
    summary: 'Primality, prime factorisation.',
    prereqs: ['qa-divisibility'],
    hours: 1,
    concept: 'To test $n$ for primality, check divisibility by primes up to $\\sqrt n$. Every prime greater than 3 is of the form $6k \\pm 1$ (the converse is false).',
  },
  {
    id: 'qa-remainders',
    area: 'Number Systems',
    name: 'Remainders',
    summary: 'Modular arithmetic, cyclicity, Fermat and Euler theorems.',
    prereqs: ['qa-divisibility', 'qa-primes'],
    hours: 3,
    concept: `Remainders multiply and add: $(ab) \\bmod n = ((a \\bmod n)(b \\bmod n)) \\bmod n$.

Negative remainders simplify powers: $14 \\equiv -1 \\pmod{15}$, so $14^{101} \\equiv -1 \\equiv 14$.

**Fermat:** for prime $p \\nmid a$, $a^{p-1} \\equiv 1 \\pmod p$. **Euler:** $a^{\\varphi(n)} \\equiv 1 \\pmod n$ when $\\gcd(a,n)=1$.`,
  },
  {
    id: 'qa-units-digit',
    area: 'Number Systems',
    name: 'Units digits',
    summary: 'Cyclicity of last digits.',
    prereqs: ['qa-remainders'],
    hours: 1,
    concept: 'Units digits of powers cycle with period 1, 2, or 4. Reduce the exponent modulo 4 (use 4 when the remainder is 0).',
  },
  {
    id: 'qa-factorials',
    area: 'Number Systems',
    name: 'Factorials',
    summary: 'Trailing zeroes and highest power of a prime in n!.',
    prereqs: ['qa-primes'],
    hours: 1.5,
    concept: 'Highest power of prime $p$ in $n!$ is $\\lfloor n/p\\rfloor + \\lfloor n/p^2\\rfloor + \\cdots$ (Legendre). Trailing zeroes of $n!$ = power of 5.',
  },
  {
    id: 'qa-integers',
    area: 'Number Systems',
    name: 'Integers',
    summary: 'Parity, consecutive integers, and integer constraints.',
    hours: 1,
    concept: 'Product of $k$ consecutive integers is divisible by $k!$. Parity arguments (odd/even) quickly rule out cases.',
  },
  {
    id: 'qa-rational-irrational',
    area: 'Number Systems',
    name: 'Rational and irrational numbers',
    summary: 'Recurring decimals and surds.',
    prereqs: ['qa-integers'],
    hours: 1,
    concept: 'A recurring decimal $0.\\overline{ab} = \\frac{ab}{99}$. A surd like $\\sqrt2$ cannot be written as $p/q$. Rationalise $\\frac{1}{\\sqrt a + \\sqrt b}$ by multiplying by $\\sqrt a - \\sqrt b$.',
  },
  {
    id: 'qa-number-properties',
    area: 'Number Systems',
    name: 'Properties of numbers',
    summary: 'Digit problems, bases, and number puzzles.',
    prereqs: ['qa-divisibility', 'qa-integers'],
    hours: 2,
    concept: 'A two-digit number with digits $a,b$ is $10a + b$; reversing changes it by $9(a - b)$. In base $k$, a numeral $d_n\\ldots d_0$ equals $\\sum d_i k^i$.',
  },
  // ------------------------------------------------------------ Geometry
  {
    id: 'qa-lines-angles',
    area: 'Geometry and Mensuration',
    name: 'Lines and angles',
    summary: 'Parallel lines, transversals, angle chasing.',
    hours: 1,
    concept: 'Alternate and corresponding angles are equal for parallel lines; co-interior angles sum to 180°. Angles on a straight line sum to 180°, around a point 360°.',
  },
  {
    id: 'qa-triangles',
    area: 'Geometry and Mensuration',
    name: 'Triangles',
    summary: 'Triangle properties, Pythagoras, area formulas, centres.',
    prereqs: ['qa-lines-angles'],
    hours: 4,
    concept: `Angle sum 180°. **Triangle inequality:** each side is less than the sum of the other two.

Area: $\\frac12bh = \\frac12ab\\sin C = \\sqrt{s(s-a)(s-b)(s-c)}$ (Heron).

Pythagoras: $a^2 + b^2 = c^2$ in a right triangle. Common triples: (3,4,5), (5,12,13), (8,15,17), (7,24,25).

Equilateral with side $a$: area $\\frac{\\sqrt3}{4}a^2$, height $\\frac{\\sqrt3}{2}a$, inradius $\\frac{a}{2\\sqrt3}$, circumradius $\\frac{a}{\\sqrt3}$.

Angle bisector theorem: the bisector from $A$ divides $BC$ in the ratio $AB:AC$.`,
  },
  {
    id: 'qa-similarity',
    area: 'Geometry and Mensuration',
    name: 'Similarity and congruence',
    summary: 'Similar triangles, ratio of areas.',
    prereqs: ['qa-triangles'],
    hours: 2,
    concept: 'Similar figures have equal corresponding angles and proportional sides with ratio $k$; their areas are in ratio $k^2$ and volumes $k^3$. A line parallel to one side of a triangle creates a similar triangle (basic proportionality theorem).',
  },
  {
    id: 'qa-quadrilaterals',
    area: 'Geometry and Mensuration',
    name: 'Quadrilaterals',
    summary: 'Parallelograms, trapezia, rhombi, and their areas.',
    prereqs: ['qa-triangles'],
    hours: 1.5,
    concept: 'Parallelogram area = base × height. Rhombus area = $\\frac12 d_1 d_2$. Trapezium area = $\\frac12(a+b)h$. A cyclic quadrilateral has opposite angles summing to 180°.',
  },
  {
    id: 'qa-polygons',
    area: 'Geometry and Mensuration',
    name: 'Polygons',
    summary: 'Interior/exterior angles and diagonals.',
    prereqs: ['qa-quadrilaterals'],
    hours: 1,
    concept: 'Sum of interior angles of an $n$-gon: $(n-2)\\times180°$. Each exterior angle of a regular polygon: $\\frac{360°}{n}$. Number of diagonals: $\\frac{n(n-3)}{2}$. Regular hexagon of side $a$: area $\\frac{3\\sqrt3}{2}a^2$.',
  },
  {
    id: 'qa-circles',
    area: 'Geometry and Mensuration',
    name: 'Circles',
    summary: 'Chords, tangents, angles in circles.',
    prereqs: ['qa-triangles'],
    hours: 3,
    concept: 'The angle at the centre is twice the angle at the circumference on the same arc; the angle in a semicircle is 90°. A tangent is perpendicular to the radius at the point of contact; tangents from an external point are equal. Intersecting chords: $AP\\cdot PB = CP\\cdot PD$.',
  },
  {
    id: 'qa-coordinate-geometry',
    area: 'Geometry and Mensuration',
    name: 'Coordinate geometry',
    summary: 'Distance, section formula, lines, slopes, areas.',
    prereqs: ['qa-linear-equations', 'qa-triangles'],
    hours: 2.5,
    concept: 'Distance $\\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}$. Slope $m = \\frac{y_2-y_1}{x_2-x_1}$; parallel lines have equal slopes; perpendicular slopes multiply to $-1$. Distance from $(x_0,y_0)$ to $ax+by+c=0$ is $\\frac{|ax_0+by_0+c|}{\\sqrt{a^2+b^2}}$.',
  },
  {
    id: 'qa-area-perimeter',
    area: 'Geometry and Mensuration',
    name: 'Perimeter and area',
    summary: '2D mensuration.',
    prereqs: ['qa-triangles', 'qa-circles'],
    hours: 1.5,
    concept: 'Circle: area $\\pi r^2$, circumference $2\\pi r$, sector area $\\frac{\\theta}{360}\\pi r^2$. For composite figures, add and subtract standard shapes rather than integrating anything new.',
  },
  {
    id: 'qa-volume-surface',
    area: 'Geometry and Mensuration',
    name: 'Surface area and volume',
    summary: '3D mensuration: prisms, cylinders, cones, spheres.',
    prereqs: ['qa-area-perimeter'],
    hours: 2,
    concept: 'Cylinder $V = \\pi r^2h$; cone $V = \\frac13\\pi r^2h$, curved surface $\\pi r l$; sphere $V = \\frac43\\pi r^3$, surface $4\\pi r^2$. When a solid is melted and recast, volume is conserved.',
  },
  {
    id: 'qa-geometry-theorems',
    area: 'Geometry and Mensuration',
    name: 'Geometric properties and theorems',
    summary: 'Mixed theorem-based geometry problems.',
    prereqs: ['qa-similarity', 'qa-circles'],
    hours: 2,
    concept: 'Apollonius: $AB^2 + AC^2 = 2(AD^2 + BD^2)$ where $D$ is the midpoint of $BC$. Medians meet at the centroid, which divides each in 2:1. Draw the figure, mark everything given, and look for right angles and similar triangles first.',
  },
  // ------------------------------------------------------------ Modern maths
  {
    id: 'qa-counting-principle',
    area: 'Modern Mathematics',
    name: 'Fundamental counting principle',
    summary: 'Multiplication and addition rules for counting.',
    hours: 1.5,
    concept: 'If a task is done in stages with $m$ then $n$ independent choices, there are $mn$ ways (AND → multiply). If choices are mutually exclusive alternatives, add (OR → add).',
  },
  {
    id: 'qa-pnc',
    area: 'Modern Mathematics',
    name: 'Permutations and combinations',
    summary: 'Arrangements and selections with and without restrictions.',
    prereqs: ['qa-counting-principle'],
    hours: 4,
    concept: `$^nP_r = \\frac{n!}{(n-r)!}$ (order matters); $^nC_r = \\frac{n!}{r!(n-r)!}$ (order does not).

Arrangements with repeats: $\\frac{n!}{p!q!\\cdots}$. Circular arrangements of $n$ distinct objects: $(n-1)!$.

**Distributing identical items** into $r$ distinct boxes: $\\binom{n+r-1}{r-1}$ (stars and bars); with each box non-empty, $\\binom{n-1}{r-1}$.`,
    traps: '- Using permutations when the order does not matter (or vice versa).\n- Double counting in "at least one" problems — use the complement.',
  },
  {
    id: 'qa-probability',
    area: 'Modern Mathematics',
    name: 'Probability',
    summary: 'Classical probability, complements, independence.',
    prereqs: ['qa-pnc'],
    hours: 3,
    concept: '$P(E) = \\frac{\\text{favourable}}{\\text{total}}$ for equally likely outcomes. $P(\\text{not } E) = 1 - P(E)$. Independent events: $P(A\\cap B) = P(A)P(B)$. $P(A \\cup B) = P(A) + P(B) - P(A\\cap B)$.',
  },
  {
    id: 'qa-set-theory',
    area: 'Modern Mathematics',
    name: 'Set theory and Venn diagrams',
    summary: 'Union, intersection, and inclusion–exclusion.',
    hours: 2,
    concept: '$|A \\cup B| = |A| + |B| - |A\\cap B|$. For three sets, add pairwise intersections back once: $|A\\cup B\\cup C| = \\sum|A| - \\sum|A\\cap B| + |A\\cap B\\cap C|$. For max/min overlap questions, set up a Venn diagram with variables for each region.',
  },
];

const VARC: TopicSeed[] = [
  { id: 'varc-rc-main-idea', area: 'Reading Comprehension', name: 'Main idea and central argument', summary: 'Identify the claim the whole passage supports.', hours: 3, concept: 'Read for the author\'s **position**, not for facts. After each paragraph, write one line: what is this paragraph doing for the argument? The main idea must cover the whole passage — options that describe one paragraph are too narrow; options that generalise beyond the passage are too broad.', traps: '- Choosing a true detail instead of the main point.\n- Choosing an option broader than the passage\'s scope.' },
  { id: 'varc-rc-purpose-tone', area: 'Reading Comprehension', name: "Author's purpose and tone", summary: 'Why the author wrote the passage and how.', prereqs: ['varc-rc-main-idea'], hours: 2, concept: 'Purpose verbs: argue, explain, critique, compare, describe. Tone is usually moderate in academic prose; extreme tone words ("vitriolic", "euphoric") are rarely correct unless the language is clearly extreme.' },
  { id: 'varc-rc-inference', area: 'Reading Comprehension', name: 'Inference-based questions', summary: 'What must be true given the passage.', prereqs: ['varc-rc-main-idea'], hours: 4, concept: 'A valid inference is a short, necessary step from the text. Test each option: "Does the passage force this to be true?" If it merely could be true, eliminate it.', traps: '- Unsupported inference: plausible in the real world but not supported by the text.\n- Extreme wording ("always", "only", "never").' },
  { id: 'varc-rc-assumptions', area: 'Reading Comprehension', name: 'Assumptions', summary: 'Unstated premises an argument depends on.', prereqs: ['varc-rc-inference'], hours: 2, concept: 'Negation test: negate the option. If the argument collapses, it is a necessary assumption.' },
  { id: 'varc-rc-strengthen-weaken', area: 'Reading Comprehension', name: 'Strengthening and weakening arguments', summary: 'Evaluate how new information affects an argument.', prereqs: ['varc-rc-assumptions'], hours: 2, concept: 'Locate the conclusion and the evidence, then the gap between them. A strengthener closes the gap; a weakener widens it, often by offering an alternative explanation.' },
  { id: 'varc-rc-evidence', area: 'Reading Comprehension', name: 'Supporting evidence', summary: 'Locate textual support for claims.', prereqs: ['varc-rc-main-idea'], hours: 1.5, concept: 'Every correct answer has a line in the passage you can point to. If you cannot find the line, you are probably inferring too far.' },
  { id: 'varc-rc-paragraph-function', area: 'Reading Comprehension', name: 'Paragraph function and logical structure', summary: 'Role of each paragraph in the argument.', prereqs: ['varc-rc-main-idea'], hours: 2, concept: 'Common roles: introduce a claim, present a counter-view, give an example, qualify an earlier point, conclude. Transition words (however, thus, for instance) signal the role.' },
  { id: 'varc-rc-fact-inference', area: 'Reading Comprehension', name: 'Fact versus inference', summary: 'Distinguish what is stated from what is implied.', prereqs: ['varc-rc-inference'], hours: 1.5, concept: 'Stated: directly in the text. Inferred: follows necessarily. Opinion: the author\'s or someone\'s judgement. Questions often hinge on whose view a statement is.' },
  { id: 'varc-rc-application', area: 'Reading Comprehension', name: 'Application and implication', summary: 'Apply the passage\'s logic to new situations.', prereqs: ['varc-rc-inference'], hours: 2, concept: 'Abstract the principle the passage uses, then find the option that has the same structure, even if the subject matter differs.' },
  { id: 'varc-rc-vocab-context', area: 'Reading Comprehension', name: 'Vocabulary in context', summary: 'Meaning of words as used in the passage.', prereqs: ['varc-rc-main-idea'], hours: 1, concept: 'Replace the word with each option and reread the sentence. The dictionary meaning is often a trap; the contextual meaning wins.' },
  { id: 'varc-va-parajumbles', area: 'Verbal Ability', name: 'Para jumbles', summary: 'Order sentences into a coherent paragraph.', hours: 3, concept: 'Find mandatory pairs: a pronoun and its referent, a term introduced then defined, an example after a claim, "however" after the view it contrasts. Find the opener (introduces the subject, no dangling reference). Build from pairs, not from guessing the first sentence.' },
  { id: 'varc-va-odd-sentence', area: 'Verbal Ability', name: 'Odd sentence out', summary: 'Identify the sentence that does not fit.', prereqs: ['varc-va-parajumbles'], hours: 2, concept: 'Build the coherent paragraph first; the odd sentence usually shares keywords but shifts scope, time, or focus.' },
  { id: 'varc-va-para-summary', area: 'Verbal Ability', name: 'Para summary', summary: 'Choose the option that best captures a paragraph.', prereqs: ['varc-rc-main-idea'], hours: 2, concept: 'A good summary keeps the main claim and its qualification, drops examples, and adds nothing new. Eliminate options that distort the relationship (cause vs correlation) or omit the key contrast.' },
  { id: 'varc-va-para-completion', area: 'Verbal Ability', name: 'Paragraph completion', summary: 'Choose the sentence that completes a paragraph.', prereqs: ['varc-va-parajumbles'], hours: 1.5, concept: 'The completing sentence must continue the last sentence\'s direction and the paragraph\'s overall thrust.' },
  { id: 'varc-va-logical-flow', area: 'Verbal Ability', name: 'Logical flow, coherence, and sentence relationships', summary: 'How sentences connect logically.', prereqs: ['varc-va-parajumbles'], hours: 1.5, concept: 'Classify each link: cause–effect, contrast, example, elaboration, sequence. Coherence fails when a link has no logical type.' },
  { id: 'varc-va-argument-evaluation', area: 'Verbal Ability', name: 'Argument evaluation', summary: 'Assess the logic of short arguments.', prereqs: ['varc-rc-assumptions'], hours: 1.5, concept: 'Identify premise → conclusion, then ask what would have to be true for the conclusion to follow.' },
];

const DILR: TopicSeed[] = [
  { id: 'dilr-di-tables', area: 'Data Interpretation', name: 'Tables', summary: 'Reading and computing from tables.', hours: 2, concept: 'Scan the headers and units before the numbers. Decide which calculation each question needs and approximate where the options are far apart.' },
  { id: 'dilr-di-bar-line', area: 'Data Interpretation', name: 'Bar and line graphs', summary: 'Trends and comparisons from charts.', prereqs: ['dilr-di-tables'], hours: 2, concept: 'Read the scale carefully (does the axis start at zero?). Slope gives rate of change; compare growth as ratios, not differences, when asked about percentage change.' },
  { id: 'dilr-di-pie', area: 'Data Interpretation', name: 'Pie charts', summary: 'Shares of a whole.', prereqs: ['dilr-di-tables'], hours: 1, concept: 'A sector of $x°$ is $\\frac{x}{360}$ of the total. Comparing two pies requires the totals; shares alone do not compare absolute values.' },
  { id: 'dilr-di-mixed-caselets', area: 'Data Interpretation', name: 'Mixed graphs and caselets', summary: 'Multi-source data and text-based data.', prereqs: ['dilr-di-bar-line', 'dilr-di-pie'], hours: 3, concept: 'Convert a caselet into a table first. For mixed graphs, note which quantity links the two visuals.' },
  { id: 'dilr-di-missing-data', area: 'Data Interpretation', name: 'Missing data and multi-variable analysis', summary: 'Reconstruct missing values from totals and constraints.', prereqs: ['dilr-di-mixed-caselets'], hours: 3, concept: 'Write row and column totals, fill what is forced, then mark remaining cells as variables with constraints. Many questions only need bounds, not exact values.' },
  { id: 'dilr-di-calculation', area: 'Data Interpretation', name: 'Approximation and calculation efficiency', summary: 'Fast, safe arithmetic for DI.', prereqs: ['qa-percentages'], hours: 2, concept: 'Use fraction–percent equivalents, round in compensating directions, and only compute precisely when options are close.' },
  { id: 'dilr-lr-arrangements', area: 'Logical Reasoning', name: 'Linear and circular arrangements', summary: 'Seating and ordering positions.', hours: 3, concept: 'Draw slots. Place fixed people first, then the most constrained. In circular arrangements fix one person to remove rotational symmetry; "facing centre" means left/right swap relative to "facing out".' },
  { id: 'dilr-lr-grouping', area: 'Logical Reasoning', name: 'Grouping, selection, and distribution', summary: 'Who goes into which group.', prereqs: ['dilr-lr-arrangements'], hours: 3, concept: 'Make a grid of items × groups. Translate "if A then B" as a rule and also its contrapositive "not B → not A".' },
  { id: 'dilr-lr-scheduling', area: 'Logical Reasoning', name: 'Scheduling and ordering', summary: 'Time-slot and ranking puzzles.', prereqs: ['dilr-lr-arrangements'], hours: 2.5, concept: 'Create a timeline. Relative constraints ("X before Y") form a partial order; draw it as a chain diagram before placing.' },
  { id: 'dilr-lr-games-tournaments', area: 'Logical Reasoning', name: 'Games and tournaments', summary: 'Round-robin and knockout reasoning.', prereqs: ['dilr-lr-scheduling'], hours: 3, concept: 'Round robin of $n$ teams: $\\binom n2$ matches. Knockout of $n$ teams: $n-1$ matches. Total points distributed per match is often fixed — use it to bound possibilities.' },
  { id: 'dilr-lr-routes-networks', area: 'Logical Reasoning', name: 'Routes and networks', summary: 'Paths, flows, and connectivity.', prereqs: ['dilr-lr-arrangements'], hours: 2, concept: 'Draw the network. Count paths systematically by node, and use flow conservation (in = out) at intermediate nodes.' },
  { id: 'dilr-lr-venn', area: 'Logical Reasoning', name: 'Venn diagrams and set-based reasoning', summary: 'Overlaps and set constraints.', prereqs: ['qa-set-theory'], hours: 2, concept: 'Assign a variable to each region. Write one equation per given total; the remaining freedom gives the max/min answers.' },
  { id: 'dilr-lr-binary-logic', area: 'Logical Reasoning', name: 'Binary logic and conditional constraints', summary: 'Truth-tellers, liars, and if–then logic.', prereqs: ['dilr-lr-grouping'], hours: 2.5, concept: 'Assume a case, propagate consequences, and stop at the first contradiction. Keep a list of what each assumption forces.' },
  { id: 'dilr-lr-matrix', area: 'Logical Reasoning', name: 'Matrix-based and complex multi-condition puzzles', summary: 'Multi-attribute grids and complex caselets.', prereqs: ['dilr-lr-grouping', 'dilr-lr-binary-logic'], hours: 4, concept: 'Use one grid per pair of attributes or a master table. Mark ✓/✗ and derive by elimination. If two cases remain, carry both and let the questions disambiguate.' },
];

export const SYLLABUS: SectionSeed[] = [
  { id: 'VARC', name: 'Verbal Ability and Reading Comprehension', position: 1, topics: VARC },
  { id: 'DILR', name: 'Data Interpretation and Logical Reasoning', position: 2, topics: DILR },
  { id: 'QA', name: 'Quantitative Aptitude', position: 3, topics: QA },
];

export const MASTERY_CRITERIA =
  'Proficient: mastery score ≥ 70 across at least 6 different questions. Exam-ready: score ≥ 85 across at least 10 different questions, including at least 3 correct difficult/advanced questions and at least 3 correct timed attempts within the estimated time.';
