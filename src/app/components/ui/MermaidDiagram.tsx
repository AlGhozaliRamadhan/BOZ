'use client';

import { useEffect, useId, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { diagramProblem } from '@/shared/markdown-diagrams';

let mermaidPromise: Promise<typeof import('mermaid')['default']> | undefined;
function loadMermaid() {
  return mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      maxTextSize: 8000,
      maxEdges: 80,
      theme: 'dark',
      fontFamily: 'Arial, sans-serif',
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    return mermaid;
  }).catch((error) => { mermaidPromise = undefined; throw error; });
}

export function MermaidDiagram({ source, complete }: { source: string; complete: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [result, setResult] = useState<{ source: string; svg?: string; error?: string }>();
  const problem = complete ? diagramProblem(source) : 'Flowchart is incomplete.';

  useEffect(() => {
    if (problem) return;
    let cancelled = false;
    async function render() {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        const { svg } = await mermaid.render(`boz-flowchart-${id}`, source);
        const safeSvg = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'animate', 'set'],
          FORBID_ATTR: ['href', 'xlink:href'],
        });
        if (!cancelled) setResult({ source, svg: safeSvg });
      } catch {
        if (!cancelled) setResult({ source, error: 'This flowchart could not be displayed.' });
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [source, id, problem]);

  const current = result?.source === source ? result : undefined;
  if (!problem && current?.svg) {
    return <figure className="chat-flowchart" aria-label="Decision flowchart">
      <div className="chat-flowchart-visual" dangerouslySetInnerHTML={{ __html: current.svg }} />
      <details><summary>View diagram source</summary><pre><code>{source}</code></pre></details>
    </figure>;
  }
  return <div className="chat-flowchart-fallback">
    <p className="chat-flowchart-status">{problem || current?.error || 'Drawing flowchart…'}</p>
    <pre><code className="language-mermaid">{source}</code></pre>
  </div>;
}
