// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMarkdown, markdownParts } from '../src/app/components/ui/ChatMarkdown';
import { ThoughtAccordion } from '../src/app/components/ui/ThoughtAccordion';
import { diagramProblem, isClosedCodeFence, truncateMarkdown } from '../src/shared/markdown-diagrams';

const { renderDiagram, initialize } = vi.hoisted(() => ({
  renderDiagram: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Wait for confirmation</text><script>alert(1)</script><foreignObject>unsafe</foreignObject><image href="https://example.com/track"/></svg>' })),
  initialize: vi.fn(),
}));
vi.mock('mermaid', () => ({ default: { initialize, render: renderDiagram } }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  renderDiagram.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const diagram = '```mermaid\nflowchart TD\nA["Volume confirms?"] --> B["Wait for confirmation"]\n```';
async function show(content: string) {
  await act(async () => { root.render(<ChatMarkdown content={content} />); });
}

describe('shared Markdown flowchart renderer', () => {
  it('renders complete flowcharts with sanitized SVG and preserves surrounding Markdown', async () => {
    await show(`**Assessment**\n\n${diagram}\n\n| Level | Price |\n|---|---|\n| Trigger | 100 |\n\n[Source](https://example.com)\n\n\`\`\`js\nconst x = 1;\n\`\`\``);
    expect(renderDiagram).toHaveBeenCalledOnce();
    expect(container.querySelector('svg text')?.textContent).toBe('Wait for confirmation');
    expect(container.querySelector('script, foreignObject, image')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('Assessment');
    expect(container.querySelector('table')?.textContent).toContain('100');
    expect(container.querySelector('a')?.href).toBe('https://example.com/');
    expect(container.querySelector('code.language-js')?.textContent).toContain('const x = 1;');
    expect(container.querySelector('details code')?.textContent).toContain('flowchart TD');
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', htmlLabels: false, startOnLoad: false }));
  });

  it('waits for the closing fence while streaming and does not re-render unchanged diagrams', async () => {
    await show(diagram.slice(0, -3));
    expect(renderDiagram).not.toHaveBeenCalled();
    expect(container.textContent).toContain('incomplete');
    await show(diagram);
    expect(renderDiagram).toHaveBeenCalledOnce();
    await show(diagram + '\n\nA later paragraph.');
    expect(renderDiagram).toHaveBeenCalledOnce();
  });

  it('renders saved thought Markdown only when the accordion opens', async () => {
    await act(() => root.render(<ThoughtAccordion thoughts={[`An evidence-based assessment.\n\n${diagram}`]} />));
    expect(renderDiagram).not.toHaveBeenCalled();
    await act(async () => { (container.querySelector('[role="button"]') as HTMLElement).click(); });
    expect(renderDiagram).toHaveBeenCalledOnce();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('keeps rejected and malformed diagrams readable and rejects unsafe HTML', async () => {
    await show('```mermaid\nflowchart TD\nclick A "javascript:alert(1)"\n```\n<img src=x onerror=alert(1)>');
    expect(renderDiagram).not.toHaveBeenCalled();
    expect(container.querySelector('code')?.textContent).toContain('click A');
    expect(container.querySelector('[onerror]')).toBeNull();
    renderDiagram.mockRejectedValueOnce(new Error('parse failed'));
    await show('```mermaid\nflowchart TD\nA[broken\n```');
    expect(container.textContent).toContain('could not be displayed');
    expect(container.querySelector('code')?.textContent).toContain('A[broken');
  });

  it('handles multiple diagrams and reference links', () => {
    const parts = markdownParts(`${diagram}\n\n[first][source]\n\n${diagram}\n\n[source]: https://example.com`);
    expect(parts.filter(part => part.type === 'mermaid')).toHaveLength(2);
    expect(parts.filter(part => part.type === 'html').map(part => part.html).join('')).toContain('href="https://example.com"');
  });
});

describe('diagram boundaries and input restrictions', () => {
  it('supports backtick and tilde fences without closing at the opening line', () => {
    expect(isClosedCodeFence('```mermaid\nflowchart TD\nA-->B')).toBe(false);
    expect(isClosedCodeFence('~~~~mermaid\nflowchart LR\nA-->B\n~~~~\n')).toBe(true);
  });

  it.each([
    ['other diagram types', 'sequenceDiagram\nAlice->>Bob: Hello'],
    ['configuration overrides', 'flowchart TD\n%%{init: {securityLevel: "loose"}}%%\nA-->B'],
    ['HTML', 'flowchart TD\nA["<img src=x>"]'],
    ['images', 'flowchart TD\nA@{ img: "https://example.com/image" }'],
    ['remote CSS', 'flowchart TD\nclassDef x fill:url(https://example.com)'],
    ['oversized diagrams', 'flowchart TD\n' + 'a'.repeat(8001)],
  ])('rejects unsupported diagram features: %s', (_label, source) => {
    expect(diagramProblem(source)).toBeTruthy();
  });

  it('never truncates through a diagram', () => {
    const content = `An assessment.\n\n${diagram}\n\nMore discussion follows here.`;
    expect(truncateMarkdown(content, 45)).toBe('An assessment.…');
    const retained = truncateMarkdown(content, content.indexOf('More') + 8);
    expect(retained).toContain(diagram);
  });
});
