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

  const clientSignal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          release();
        }
      };
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const stopHeartbeat = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };
      const onClientAbort = () => {
        stopHeartbeat();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      if (clientSignal.aborted) {
        doRelease();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
        return;
      }
      clientSignal.addEventListener('abort', onClientAbort, { once: true });
      // Keep-alive comment so proxies don't buffer and the client can tell
      // a live-but-quiet engine apart from a dead connection. The client
      // parser skips `: comment` lines, so no protocol change is needed.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // Client went away; abort handler closes the stream.
        }
      }, 15000);

      const engine = new WebChatEngine();

      try {
        for await (const event of engine.run({
          message: body.message,
          history: body.history,
          effort,
          thinking,
          model: body.model,
          signal: clientSignal,
        })) {
          if (clientSignal.aborted) break;
          const payload = JSON.stringify(event.data);
          const sseMessage = `event: ${event.type}\ndata: ${payload}\n\n`;
          controller.enqueue(encoder.encode(sseMessage));
        }
      } catch (err) {
        if (clientSignal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          // User pressed Stop: engine gave up without a terminal event.
          // Just close; the client already settled as cancelled.
        } else {
          const failure: ChatStreamFailure = {
            status: typeof (err as { status?: unknown })?.status === 'number'
              ? (err as { status: number }).status
              : undefined,
            code: typeof (err as { code?: unknown })?.code === 'string'
              ? (err as { code: string }).code
              : undefined,
            message: err instanceof Error ? err.message : undefined,
          };
          const sseError = `event: error\ndata: ${JSON.stringify({
            code: classifyChatStreamFailure(failure),
            message: describeChatStreamFailure(failure),
          })}\n\n`;
          try {
            controller.enqueue(encoder.encode(sseError));
          } catch {
            // Client went away mid-error.
          }
        }
      } finally {
        stopHeartbeat();
        clientSignal.removeEventListener('abort', onClientAbort);
        doRelease();
        try {
          controller.close();
        } catch {
          // Already closed by abort handler.
        }
      }
    },
    cancel() {
      release();
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
