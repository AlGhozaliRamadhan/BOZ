/** Fenced blocks must be complete before rendering or retaining a truncated note. */
export function isClosedCodeFence(raw: string): boolean {
  const opening = raw.match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n/);
  if (!opening) return false;
  const fence = opening[1];
  return new RegExp(`(?:^|\\n) {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\n)?$`).test(raw.slice(opening[0].length));
}

export const MAX_DIAGRAM_CHARS = 8000;

export function diagramProblem(source: string): string | null {
  if (source.length > MAX_DIAGRAM_CHARS) return 'This flowchart is too large to display.';
  if (!/^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/.test(source)) {
    return 'Only Mermaid flowcharts are supported.';
  }
  // Model-authored configuration, HTML, links, CSS, and image nodes cannot
  // override the application's rendering policy or load remote resources.
  if (/%%\s*\{|^\s*---|(?:^|[;\n])\s*(?:click|style|classDef)\b|<\/?[a-z!]|@\s*\{|(?:https?|data|javascript|file):|url\s*\(/im.test(source)) {
    return 'This flowchart contains unsupported formatting or links.';
  }
  return null;
}

/** Never leave half a fenced block in a shortened public analysis note. */
export function truncateMarkdown(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = Math.max(0, maxLength - 1);
  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  let fence: { marker: string; start: number } | undefined;
  for (const line of lines) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = { marker: match[1], start: offset };
      else if (match[1][0] === fence.marker[0] && match[1].length >= fence.marker.length && /^\s*$/.test(line.slice(match[0].length))) {
        if (fence.start < end && offset + line.trimEnd().length > end) end = fence.start;
        fence = undefined;
      }
    }
    offset += line.length;
    if (offset > end && fence) { end = fence.start; break; }
    if (offset > end) break;
  }
  const slice = text.slice(0, end).trimEnd();
  const boundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  const bounded = end === maxLength - 1 && boundary > end * 0.75 ? slice.slice(0, boundary) : slice;
  return bounded ? `${bounded.trimEnd()}…` : '';
}
