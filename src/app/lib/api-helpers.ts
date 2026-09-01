import { NextResponse } from 'next/server';

export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
export const MAX_CHAT_MESSAGE_CHARS = 16_000;
export const MAX_CHAT_HISTORY_MESSAGES = 20;
export const MAX_CHAT_MODEL_CHARS = 256;

export class InvalidJsonBodyError extends Error {
  constructor() {
    super('Invalid JSON body');
    this.name = 'InvalidJsonBodyError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super('Content-Type must be application/json');
    this.name = 'UnsupportedMediaTypeError';
  }
}

export class InvalidRequestBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestBodyError';
  }
}

export function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseBody<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new UnsupportedMediaTypeError();

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new InvalidJsonBodyError();
    if (parsedLength > MAX_REQUEST_BODY_BYTES) throw new PayloadTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new InvalidJsonBodyError();

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export interface ChatRequestBody {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
}

export function validateChatRequestBody(body: unknown): ChatRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InvalidRequestBodyError('Request body must be an object');
  }

  const candidate = body as Record<string, unknown>;
  if (typeof candidate.message !== 'string' || !candidate.message.trim()) {
    throw new InvalidRequestBodyError('Message is required');
  }
  if (candidate.message.length > MAX_CHAT_MESSAGE_CHARS) {
    throw new InvalidRequestBodyError(`Message exceeds ${MAX_CHAT_MESSAGE_CHARS} characters`);
  }

  let history: ChatRequestBody['history'];
  if (candidate.history !== undefined) {
    if (!Array.isArray(candidate.history) || candidate.history.length > MAX_CHAT_HISTORY_MESSAGES) {
      throw new InvalidRequestBodyError(`History must contain at most ${MAX_CHAT_HISTORY_MESSAGES} messages`);
    }
    history = candidate.history.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new InvalidRequestBodyError('History entries must be objects');
      }
      const message = entry as Record<string, unknown>;
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
        throw new InvalidRequestBodyError('History entries require a valid role and string content');
      }
      if (message.content.length > MAX_CHAT_MESSAGE_CHARS) {
        throw new InvalidRequestBodyError(`History content exceeds ${MAX_CHAT_MESSAGE_CHARS} characters`);
      }
      return { role: message.role, content: message.content };
    });
  }

  let model: string | undefined;
  if (candidate.model !== undefined) {
    if (typeof candidate.model !== 'string' || candidate.model.length > MAX_CHAT_MODEL_CHARS || /[\r\n\0]/.test(candidate.model)) {
      throw new InvalidRequestBodyError('Model is invalid');
    }
    model = candidate.model.trim() || undefined;
  }

  return { message: candidate.message.trim(), history, model };
}

export function requestBodyErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof PayloadTooLargeError) return errorResponse(error.message, 413);
  if (error instanceof UnsupportedMediaTypeError) return errorResponse(error.message, 415);
  if (error instanceof InvalidJsonBodyError || error instanceof InvalidRequestBodyError) {
    return errorResponse(error.message, 400);
  }
  return null;
}
