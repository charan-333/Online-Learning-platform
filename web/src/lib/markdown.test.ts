import { describe, expect, it } from 'vitest';
import { extractMath, markdownToHtml, restoreMath } from './markdown';

describe('markdown + math', () => {
  it('renders inline and display math with KaTeX', () => {
    const { html, math } = markdownToHtml('Net change $a + b + \\frac{ab}{100}$.\n\n$$x^2$$');
    expect(math).toHaveLength(2);
    const out = restoreMath(html, math);
    expect(out).toContain('katex');
    expect(out).toContain('katex-display');
  });
  it('does not treat underscores in math as emphasis', () => {
    const { html, math } = markdownToHtml('$a_1 + a_2$ and $b_1$');
    expect(html).not.toContain('<em>');
    expect(math).toHaveLength(2);
  });
  it('leaves currency alone', () => {
    const { math } = extractMath('It costs $5 and then $10 more.');
    expect(math).toHaveLength(0);
  });
  it('renders tables', () => {
    const { html } = markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });
});
