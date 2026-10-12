import katex from 'katex';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$((?:\\\$|[^$\n])+?)\$/g;

/**
 * Pulls TeX out of markdown before markdown parsing (so `_` and `*` inside formulas
 * are not treated as emphasis) and returns placeholders plus the rendered KaTeX.
 * A single `$` followed by a digit and a space-separated word (currency) is left alone.
 */
export function extractMath(src: string) {
  const math: string[] = [];
  const text = src.replace(MATH_RE, (whole, display, displayB, inlineB, inline, offset: number, all: string) => {
    const tex = display ?? displayB ?? inlineB ?? inline;
    const isDisplay = display !== undefined || displayB !== undefined;
    // "costs $5 and $10" style currency: skip if the inline body starts with a digit and ends with a space
    if (!isDisplay && inline !== undefined && /^\d/.test(inline) && /\s$/.test(inline)) return whole;
    if (!isDisplay && inline !== undefined && /\d/.test(all[offset + whole.length] ?? '')) return whole;
    let html: string;
    try {
      html = katex.renderToString(tex.trim(), { displayMode: isDisplay, throwOnError: false, trust: false, strict: 'ignore' });
    } catch {
      html = `<code>${tex.replace(/[<>&]/g, (c: string) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</code>`;
    }
    math.push(html);
    return `@@MATH${math.length - 1}@@`;
  });
  return { text, math };
}

export function restoreMath(html: string, math: string[]) {
  return html.replace(/@@MATH(\d+)@@/g, (_, i) => math[Number(i)] ?? '');
}

/** Markdown → HTML with math. The caller must sanitise the markdown HTML before restoring math. */
export function markdownToHtml(src: string, inline = false) {
  const { text, math } = extractMath(src ?? '');
  const html = inline ? (marked.parseInline(text) as string) : (marked.parse(text) as string);
  return { html, math };
}
