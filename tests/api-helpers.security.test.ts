import { describe, expect, it } from 'vitest';
import {
  MAX_REQUEST_BODY_BYTES,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  parseBody,
  validateChatRequestBody,
} from '../src/app/lib/api-helpers';

describe('bounded API body parsing', () => {
  it('accepts JSON media-type parameters', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true }),
    });
    await expect(parseBody<{ ok: boolean }>(request)).resolves.toEqual({ ok: true });
  });

  it('rejects a streamed body above the cap without relying on Content-Length', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }),
    });
    await expect(parseBody(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('rejects non-JSON media types', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    await expect(parseBody(request)).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it('bounds chat history, messages, and model identifiers', () => {
    expect(() => validateChatRequestBody({ message: 'x'.repeat(16_001) })).toThrow(/Message exceeds/);
    expect(() => validateChatRequestBody({ message: 'ok', history: Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' })) })).toThrow(/History/);
    expect(() => validateChatRequestBody({ message: 'ok', model: 'bad\nmodel' })).toThrow(/Model/);
  });
});
