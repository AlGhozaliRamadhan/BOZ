import { NextRequest } from 'next/server';
import { WebChatEngine } from '../chat.engine';
import type { ThoughtEffort } from '@/shared/thought-prompts';
import {
  parseBody,
  requestBodyErrorResponse,
  validateChatRequestBody,
} from '@/app/lib/api-helpers';
import { chatWorkloadGate } from '@/services/security/workload-gate';
import {
  classifyChatStreamFailure,
  describeChatStreamFailure,
  type ChatStreamFailure,
} from '@/shared/chat-stream-failure';

const VALID_EFFORTS: ThoughtEffort[] = ['Low', 'Medium', 'High', 'Extra', 'Max'];

export async function POST(request: NextRequest) {
  let rawBody: Record<string, unknown>;
  try {
    const parsed = await parseBody<unknown>(request);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json({ error: 'Request body must be an object' }, { status: 400 });
    }
    rawBody = parsed as Record<string, unknown>;
  } catch (error) {
    return requestBodyErrorResponse(error) ?? Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let body: ReturnType<typeof validateChatRequestBody>;
  try {
    body = validateChatRequestBody(rawBody);
  } catch (error) {
    return requestBodyErrorResponse(error) ?? Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const effort: ThoughtEffort =
    typeof rawBody.effort === 'string' && VALID_EFFORTS.includes(rawBody.effort as ThoughtEffort)
      ? (rawBody.effort as ThoughtEffort)
      : 'Medium';
  const thinking = rawBody.thinking !== false;

  const release = chatWorkloadGate.tryAcquire();
  if (!release) return Response.json({
    code: 'busy',
    error: 'Too many chat requests are already running',
  }, { status: 429 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const engine = new WebChatEngine();

      try {
        for await (const event of engine.run({
          message: body.message,
          history: body.history,
          effort,
          thinking,
          model: body.model,
        })) {
          const payload = JSON.stringify(event.data);
          const sseMessage = `event: ${event.type}\ndata: ${payload}\n\n`;
          controller.enqueue(encoder.encode(sseMessage));
        }
      } catch (err) {
        const failure: ChatStreamFailure = {
          status: typeof (err as { status?: unknown })?.status === 'number'
            ? (err as { status: number }).status
            : undefined,
          message: err instanceof Error ? err.message : undefined,
        };
        const sseError = `event: error\ndata: ${JSON.stringify({
          code: classifyChatStreamFailure(failure),
          message: describeChatStreamFailure(failure),
        })}\n\n`;
        controller.enqueue(encoder.encode(sseError));
      } finally {
        release();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',  // Disable nginx buffering
    },
  });
}
