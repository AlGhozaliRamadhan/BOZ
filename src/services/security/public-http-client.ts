import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import {
  resolveAndValidateOutboundHttpUrl,
  type HostResolver,
  type ResolvedAddress,
  UnsafeOutboundUrlError,
} from './outbound-url-policy.js';

export const MAX_PUBLIC_TEXT_BYTES = 1_000_000;
const MAX_REDIRECTS = 4;

export type PublicResponseOpener = (
  url: URL,
  addresses: ResolvedAddress[],
  options: PublicTextOptions,
) => Promise<IncomingMessage>;

export interface PublicTextOptions {
  maxBytes?: number;
  maxRedirects?: number;
  resolveHost?: HostResolver;
  timeoutMs?: number;
  headers?: Record<string, string>;
  openResponse?: PublicResponseOpener;
}

export class PublicResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Remote response exceeds ${maxBytes} bytes`);
    this.name = 'PublicResponseTooLargeError';
  }
}

function pinnedLookup(addresses: ResolvedAddress[]): NonNullable<RequestOptions['lookup']> {
  return ((_: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const wantsAll = typeof options === 'object' && options !== null && 'all' in options
      && (options as { all?: boolean }).all === true;
    if (wantsAll) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })));
      return;
    }
    const selected = addresses[0];
    callback(null, selected.address, selected.family);
  }) as NonNullable<RequestOptions['lookup']>;
}

function openPinned(url: URL, addresses: ResolvedAddress[], options: PublicTextOptions): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      headers: {
        'User-Agent': 'BOZ/secure-web-reader',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'Accept-Encoding': 'identity',
        ...options.headers,
      },
      lookup: pinnedLookup(addresses),
    }, resolve);
    request.setTimeout(options.timeoutMs ?? 10_000, () => request.destroy(new Error('Remote request timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function readBoundedResponse(response: IncomingMessage, maxBytes: number): Promise<string> {
  const declaredLength = response.headers['content-length'];
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      response.destroy();
      throw new PublicResponseTooLargeError(maxBytes);
    }
  }

  const encoding = response.headers['content-encoding']?.toLowerCase();
  if (encoding && encoding !== 'identity') {
    response.destroy();
    throw new Error('Compressed remote responses are not accepted');
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > maxBytes) {
      response.destroy();
      throw new PublicResponseTooLargeError(maxBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, received).toString('utf8');
}

export async function readBoundedFetchText(response: Response, maxBytes = MAX_PUBLIC_TEXT_BYTES): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) throw new PublicResponseTooLargeError(maxBytes);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new PublicResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function fetchPublicText(rawUrl: string, options: PublicTextOptions = {}): Promise<{ url: URL; text: string }> {
  const maxBytes = options.maxBytes ?? MAX_PUBLIC_TEXT_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = new URL(rawUrl);
  current.hash = '';

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const validated = await resolveAndValidateOutboundHttpUrl(current.toString(), {
      allowQuery: true,
      resolveHost: options.resolveHost,
    });
    if (validated.url.protocol !== 'https:') {
      throw new UnsafeOutboundUrlError('Public web pages must use HTTPS');
    }

    const response = await (options.openResponse ?? openPinned)(validated.url, validated.addresses, options);
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) throw new Error('Remote redirect did not include a Location header');
      if (redirects === maxRedirects) throw new Error('Remote response exceeded the redirect limit');
      current = new URL(location, validated.url);
      current.hash = '';
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new Error(`Remote server returned HTTP ${status}`);
    }

    const contentType = response.headers['content-type']?.toLowerCase();
    if (contentType && !/^(text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/.test(contentType)) {
      response.destroy();
      throw new Error('Remote response is not readable text');
    }
    return { url: validated.url, text: await readBoundedResponse(response, maxBytes) };
  }

  throw new Error('Remote response exceeded the redirect limit');
}
