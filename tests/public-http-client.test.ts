import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import {
  PublicResponseTooLargeError,
  fetchPublicText,
  readBoundedFetchText,
} from '../src/services/security/public-http-client';
import { UnsafeOutboundUrlError } from '../src/services/security/outbound-url-policy';

function incoming(statusCode: number, headers: Record<string, string>, body = ''): IncomingMessage {
  const response = Readable.from(body ? [Buffer.from(body)] : []) as IncomingMessage;
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

describe('bounded fetch response reader', () => {
  it('rejects an oversized declared response before buffering', async () => {
    const response = new Response('small', { headers: { 'content-length': '1000' } });
    await expect(readBoundedFetchText(response, 10)).rejects.toBeInstanceOf(PublicResponseTooLargeError);
  });

  it('rejects a chunked response once its actual bytes exceed the cap', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.enqueue(new TextEncoder().encode('67890'));
        controller.close();
      },
    }));
    await expect(readBoundedFetchText(response, 8)).rejects.toBeInstanceOf(PublicResponseTooLargeError);
  });

  it('revalidates every redirect before opening the next connection', async () => {
    let opened = 0;
    const resolveHost = async (hostname: string) => hostname === 'private.example.test'
      ? [{ address: '127.0.0.1', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }];

    await expect(fetchPublicText('https://public.example.test/start', {
      resolveHost,
      openResponse: async () => {
        opened++;
        return incoming(302, { location: 'https://private.example.test/admin' });
      },
    })).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(opened).toBe(1);
  });

  it('passes only the DNS-validated addresses to the pinned opener', async () => {
    const captured: string[] = [];
    const result = await fetchPublicText('https://public.example.test/report?q=boz#section', {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      openResponse: async (url, addresses) => {
        captured.push(`${url.toString()}@${addresses.map((item) => item.address).join(',')}`);
        return incoming(200, { 'content-type': 'text/html' }, '<p>bounded</p>');
      },
    });

    expect(result.text).toBe('<p>bounded</p>');
    expect(captured).toEqual(['https://public.example.test/report?q=boz@93.184.216.34']);
  });
});
