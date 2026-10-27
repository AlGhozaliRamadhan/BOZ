// Which provider BOZ should treat as active when `AI_PROVIDER` is not set.
//
// This is deliberately a pure function over an env snapshot: the desktop shell
// starts the sidecar with an inherited environment, and several unrelated tools
// export `OPENAI_*` variables. Reading them as "the user chose OpenAI" is how a
// machine that only ever ran a local 9router ended up showing OpenAI as active.

export type ProviderId =
  | 'github'
  | 'offline'
  | 'nvidia'
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'openrouter';

type EnvSnapshot = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * True when a base URL points at this machine.
 *
 * A loopback `OPENAI_BASE_URL` is an OpenAI-compatible *router* (9router,
 * LM Studio, vLLM, LiteLLM), never the hosted OpenAI API. Router setup guides
 * tell users to export `OPENAI_BASE_URL=http://localhost:<port>/v1`, so the
 * name alone cannot be trusted to mean "OpenAI".
 */
export function isLocalAiEndpoint(raw: string | undefined): boolean {
  const value = (raw || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

function has(env: EnvSnapshot, key: string): boolean {
  return Boolean((env[key] || '').trim());
}

/**
 * Resolve the active provider when the user has no saved selection.
 *
 * Order matters:
 *  1. Any explicit 9router/custom setting wins — that provider has no hosted
 *     credential to detect, so the presence of its config *is* the signal.
 *  2. A local `OPENAI_BASE_URL` means a router, so the provider is `custom`
 *     even when `OPENAI_API_KEY` is present.
 *  3. Hosted providers are only detected from a key that could actually reach
 *     their own API.
 *  4. Nothing configured → `custom` (the local default), never a cloud guess.
 */
export function resolveUnconfiguredProvider(env: EnvSnapshot): ProviderId {
  if (has(env, 'CUSTOM_AI_MODEL') || has(env, 'CUSTOM_AI_URL') || has(env, 'CUSTOM_AI_KEY')) return 'custom';

  const openAiKey = has(env, 'OPENAI_API_KEY');
  const openAiEndpoint = env.OPENAI_BASE_URL;
  const openAiIsLocalRouter = openAiKey && isLocalAiEndpoint(openAiEndpoint);

  if (openAiKey && !openAiIsLocalRouter) return 'openai';
  if (has(env, 'OPENROUTER_API_KEY')) return 'openrouter';
  if (has(env, 'ANTHROPIC_API_KEY')) return 'anthropic';
  if (has(env, 'GROQ_API_KEY')) return 'groq';
  if (has(env, 'NVIDIA_API_KEY')) return 'nvidia';
  if (has(env, 'GITHUB_TOKEN')) return 'github';
  if (has(env, 'OFFLINE_AI_URL')) return 'offline';

  // Either nothing is configured or only a loopback OpenAI-compatible router
  // is: both are the local provider, so the app can say "pick a model" rather
  // than silently calling a hosted API the user never set up.
  return 'custom';
}
