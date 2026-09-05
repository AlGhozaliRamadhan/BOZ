export interface ToolThoughtData {
  tool: string;
  args?: Record<string, unknown>;
  fact?: string;
}

function formatToolArguments(args?: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? ` (${entries.map(([, value]) => String(value)).join(', ')})` : '';
}

export function toolThoughtMarker(tool: string, args?: Record<string, unknown>): string {
  return `tool used: ${tool}${formatToolArguments(args)}`;
}

export function toolStartThought(tool: string, args?: Record<string, unknown>): string {
  return toolThoughtMarker(tool, args);
}

export function updateToolResultThought(
  thoughts: string[],
  { tool, args, fact }: ToolThoughtData,
): string[] {
  const marker = toolThoughtMarker(tool, args);
  const resultText = fact ? ` — ${fact.substring(0, 140)}${fact.length > 140 ? '…' : ''}` : '';
  const next = [...thoughts];
  const thoughtIndex = next.findLastIndex(thought => thought === marker);

  if (thoughtIndex === -1) {
    next.push(`${marker}${resultText}`);
  } else {
    next[thoughtIndex] = `${marker}${resultText}`;
  }

  return next;
}
