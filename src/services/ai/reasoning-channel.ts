// ─── services/ai/reasoning-channel.ts ────────────────────────────────────────
// Provider reasoning as a TYPED channel, structurally separate from answer text.
//
// Every OpenAI-compatible provider BOZ supports exposes reasoning in-band, but
// disagrees on the field name: DeepSeek and Qwen use `reasoning_content`,
// OpenRouter uses `reasoning`, NVIDIA mirrors the former. Before this module
// the adapter read `delta.content` only, so that reasoning was generated,
// billed for, and thrown away — and the chat engine's entire multi-pass budget
// was spent re-deriving the same analysis through prompt instructions.
//
// The rule this module exists to enforce: reasoning is a SIBLING of text, never
// a substring of it. It is never concatenated into the answer, never counted
// as visible output, and never replayed as user-visible context.

/** One piece of a model response. */
export type LLMStreamChunk =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string };

export function textChunk(text: string): LLMStreamChunk {
  return { type: 'text', text };
}

export function reasoningChunk(text: string): LLMStreamChunk {
  return { type: 'reasoning', text };
}

/**
 * Read a property without letting a hostile accessor decide the channel.
 *
 * Provider payloads are attacker-reachable in the `custom` / `offline` paths,
 * where an endpoint is user-configured. Two rules, both load-bearing:
 *
 *   • An own ACCESSOR property is treated as absent. Falling back to
 *     `value[key]` there would invoke it, letting a hostile payload inject its
 *     own text into the reasoning transcript.
 *   • Only an inherited value (no own descriptor at all) justifies a guarded
 *     plain read, which is what makes this work on class instances.
 */
function safeProp(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined) {
      return 'value' in descriptor ? descriptor.value : undefined;
    }
  } catch {
    // Trapped descriptor lookup — fall through to the guarded read.
  }
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Provider field names for in-band reasoning, in precedence order.
 *
 * `reasoning` is checked last on purpose: on OpenRouter it can also be an
 * object (`{type:'reasoning', summary:[]}`), and a structured summary is not
 * the raw scratchpad we want to forward.
 */
const REASONING_FIELDS = ['reasoning_content', 'reasoning'] as const;

function usableReasoning(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Reasoning from one streaming delta, or `undefined` when the provider sent none.
 *
 * Whitespace-only fragments are dropped: providers routinely open a reasoning
 * block with an empty string, and emitting it would spawn a disclosure row for
 * nothing.
 */
export function readReasoningDelta(delta: unknown): string | undefined {
  for (const field of REASONING_FIELDS) {
    const text = usableReasoning(safeProp(delta, field));
    if (text !== undefined && text.trim().length > 0) return text;
  }
  return undefined;
}

/** Reasoning from one non-streaming assistant message. */
export function readReasoningMessage(message: unknown): string | undefined {
  return readReasoningDelta(message);
}

/**
 * Reasoning from an Anthropic-shaped `content` array, where thinking arrives
 * as its own typed block rather than a side field.
 */
export function readAnthropicReasoning(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const type = safeProp(block, 'type');
    const text = usableReasoning(safeProp(block, 'thinking')) ?? usableReasoning(safeProp(block, 'text'));
    if (text === undefined) continue;
    if (type === 'thinking' || type === 'redacted_thinking') parts.push(text);
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

/**
 * Normalize whatever a provider stream yielded into a typed chunk.
 *
 * Accepts a bare string as text, because that is what a well-behaved caller
 * means and it keeps the boundary forgiving rather than throwing mid-stream.
 * Returns `null` for empty or unusable values so callers can skip them without
 * a length check at every site.
 */
export function toStreamChunk(value: unknown): LLMStreamChunk | null {
  if (typeof value === 'string') {
    return value.length > 0 ? textChunk(value) : null;
  }
  const type = safeProp(value, 'type');
  const text = usableReasoning(safeProp(value, 'text'));
  if (text === undefined) return null;
  if (type === 'reasoning') return reasoningChunk(text);
  if (type === 'text') return textChunk(text);
  return null;
}

/** The visible-text portion of a chunk stream, concatenated. */
export function joinVisibleText(chunks: Iterable<LLMStreamChunk>): string {
  let out = '';
  for (const chunk of chunks) {
    if (chunk.type === 'text') out += chunk.text;
  }
  return out;
}