import OpenAI from 'openai';
import { validateCustomProviderEndpoint, validateOutboundHttpUrl } from '../security/outbound-url-policy.js';

const MAX_MODELS_RESPONSE_BYTES = 1_000_000;

async function restrictedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  await validateOutboundHttpUrl(requestUrl, { allowLoopback: true });
  return fetch(input, { ...init, redirect: 'manual' });
}

export async function createCustomProviderClient(options: {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<OpenAI> {
  const baseURL = await validateCustomProviderEndpoint(options.endpoint);
  return new OpenAI({
    apiKey: options.apiKey || 'not-needed',
    baseURL,
    timeout: options.timeoutMs,
    fetch: restrictedFetch,
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_MODELS_RESPONSE_BYTES) {
    throw new Error('Custom model response is too large');
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MODELS_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Custom model response is too large');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function fetchCustomProviderModels(options: {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const endpoint = await validateCustomProviderEndpoint(options.endpoint);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  const response = await restrictedFetch(`${endpoint}/models`, {
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
  });
  if (!response.ok) throw new Error(`Custom provider returned HTTP ${response.status}`);
  return readBoundedJson(response);
}
