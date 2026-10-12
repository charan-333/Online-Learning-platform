import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { markdownToHtml, restoreMath } from '../lib/markdown';

/** Renders trusted-format but untrusted-content markdown: sanitised HTML, then KaTeX restored. */
export function Markdown({ text, inline = false, className = '' }: { text: string | null | undefined; inline?: boolean; className?: string }) {
  const html = useMemo(() => {
    const { html, math } = markdownToHtml(text ?? '', inline);
    const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    return restoreMath(clean, math);
  }, [text, inline]);
  const Tag = inline ? 'span' : 'div';
  return <Tag className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
