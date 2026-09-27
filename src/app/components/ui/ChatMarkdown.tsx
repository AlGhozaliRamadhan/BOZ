'use client';

import { useMemo } from 'react';
import { marked, type Token, type TokensList } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { isClosedCodeFence } from '@/shared/markdown-diagrams';
import { MermaidDiagram } from './MermaidDiagram';

type Part = { type: 'html'; html: string } | { type: 'mermaid'; source: string; complete: boolean };

export function markdownParts(content: string): Part[] {
  try {
    const tokens = marked.lexer(content, { breaks: true, gfm: true });
    const parts: Part[] = [];
    let pending: Token[] = [];
    const flush = () => {
      if (!pending.length) return;
      const group = Object.assign(pending, { links: tokens.links }) as TokensList;
      parts.push({ type: 'html', html: DOMPurify.sanitize(marked.parser(group, { breaks: true, gfm: true, async: false })) });
      pending = [];
    };
    for (const token of tokens) {
      if (token.type === 'code' && token.lang?.trim().toLowerCase() === 'mermaid') {
        flush();
        parts.push({ type: 'mermaid', source: token.text, complete: isClosedCodeFence(token.raw) });
      } else pending.push(token);
    }
    flush();
    return parts;
  } catch {
    // React escapes the fallback; never treat a parse failure as trusted HTML.
    const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return [{ type: 'html', html: `<pre>${escaped}</pre>` }];
  }
}

export function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  const parts = useMemo(() => markdownParts(content), [content]);
  return <div className={className}>{parts.map((part, index) => part.type === 'mermaid'
    ? <MermaidDiagram key={index} source={part.source} complete={part.complete} />
    : <div key={index} dangerouslySetInnerHTML={{ __html: part.html }} />)}</div>;
}
