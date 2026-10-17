// ─── shared/reasoning-support.ts ─────────────────────────────────────────────
// What the selected provider can actually do about "thinking effort".
//
// Two independent things get conflated under one user-facing control, and only
// one of them is universal:
//
//   1. BOZ's own multi-pass structure (`EFFORT_PASSES`). This is local: a higher
//      tier runs more verification passes. It works on EVERY provider, because
//      it never leaves the process.
//   2. A native `reasoning_effort` sent to the model. This only works where the
//      provider accepts the key.
//
// Before this module, (2) was silently dropped for openai, anthropic, custom
// and offline — so choosing "Max — maximum compute & stress-test" changed the
// pass count and nothing else, while the label implied far more. The rule
// adopted here is that a control may never advertise more than it delivers:
// this module names the capability so the UI can say what is actually in play.
//
// Pure module: no `use client`, no config import — the adapter and the browser
// both read it, so it must not reach into `src/config`.

/** How a provider treats a requested reasoning effort. */
export type ReasoningEffortTransport =
  /** Accepts `reasoning_effort` on the wire and acts on it. */
  | 'native'
  /** Uses a provider-specific budget parameter instead. */
  | 'budget'
  /** Understands reasoning but exposes no effort knob. */
  | 'detect'
  /** No reasoning channel BOZ can reach. */
  | 'none';

const EFFORT_TRANSPORT: Readonly<Record<string, ReasoningEffortTransport>> = {
  openai: 'native',
  groq: 'native',
  openrouter: 'native',
  github: 'native',
  nvidia: 'budget',
  // OpenAI-compatible, so it accepts the key when the upstream model does.
  custom: 'native',
  anthropic: 'none',
  offline: 'detect',
};

export function reasoningEffortTransport(provider: string): ReasoningEffortTransport {
  return EFFORT_TRANSPORT[provider] ?? 'none';
}

/**
 * True when `reasoning_effort` may be put on the wire for this provider.
 *
 * Only `native` routes send it. Sending an unknown key to a strict proxy is
 * worse than not sending it, which is why `budget`, `detect`, and `none` are
 * all excluded here and handled by their own provider-specific branches.
 */
export function providerHonorsReasoningEffort(provider: string): boolean {
  return reasoningEffortTransport(provider) === 'native';
}

export interface ReasoningSupport {
  /** Whether the provider acts on a requested reasoning effort at all. */
  readonly honorsEffort: boolean;
  /** One-line explanation for the effort picker. */
  readonly note: string;
}

/**
 * Describes what the effort tier can do for this provider.
 *
 * Deliberately never says the tier is useless: it always changes BOZ's own
 * pass count. It only states whether the model's own thinking budget moves too.
 */
export function describeReasoningSupport(provider: string): ReasoningSupport {
  switch (reasoningEffortTransport(provider)) {
    case 'native':
      return { honorsEffort: true, note: 'Effort sets the model\'s reasoning budget and BOZ\'s verification passes.' };
    case 'budget':
      return { honorsEffort: true, note: 'Effort sets a reasoning budget and BOZ\'s verification passes.' };
    case 'detect':
      return {
        honorsEffort: false,
        note: 'This endpoint sets its own reasoning level. Effort still changes how many times BOZ verifies the answer.',
      };
    default:
      return {
        honorsEffort: false,
        note: 'This provider has no reasoning control. Effort still changes how many times BOZ verifies the answer.',
      };
  }
}