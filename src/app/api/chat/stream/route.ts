import { NextRequest } from 'next/server';
import { WebChatEngine, type ChatRetryEventData, type ChatToolRetryEventData } from '../chat.engine';
import type { ThoughtEffort } from '@/shared/thought-prompts';
import {
  parseBody,
  requestBodyErrorResponse,
  validateChatRequestBody,
} from '@/app/lib/api-helpers';
import { chatWorkloadGate } from '@/services/security/workload-gate';
import {
  chatStreamFailureFromLlmFailure,
  classifyChatStreamFailure,
  describeChatStreamFailure,
  type ChatStreamFailure,
} from '@/shared/chat-stream-failure';
import { normalizeLlmFailure } from '@/shared/llm-retry';

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

      /**
       * Retry notices bypass the generator because a retried pass streams
       * nothing — `run()` is parked awaiting the provider while the backoff
       * runs, so a `yield` there would only surface after the retry already
       * completed. Emitting directly keeps the notice in the same ordered
       * stream and lets the client show a countdown the user can Stop.
       */
      const enqueueRetryNotice = (data: ChatRetryEventData) => {
        if (clientSignal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`event: retry\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client went away mid-notice; the abort handler closes the stream.
        }
      };

      /**
       * TOOL retry notices flow the same direct route as provider retries: a
       * tool round is awaited mid-generator, so the engine cannot yield these
       * from inside it. The client marks the exact running row in the thinking
       * panel rather than a stack-level countdown.
       */
      const enqueueToolRetryNotice = (data: ChatToolRetryEventData) => {
        if (clientSignal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`event: tool_retry\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client went away mid-notice; the abort handler closes the stream.
        }
      };

      /**
       * Provider reasoning is forwarded on its own SSE channel.
       *
       * The first delta also emits `reasoning_start`, which is what opens the
       * client's disclosure. A pass streams no answer tokens, so without this
       * the model would look stalled for the whole of every synthesis pass.
       */
      let reasoningOpen = false;
      const enqueueReasoning = (text: string) => {
        if (clientSignal.aborted || !text) return;
        try {
          if (!reasoningOpen) {
            reasoningOpen = true;
            controller.enqueue(encoder.encode('event: reasoning_start\ndata: {}\n\n'));
          }
          controller.enqueue(encoder.encode(`event: reasoning\ndata: ${JSON.stringify({ text })}\n\n`));
        } catch {
          // Client went away mid-pass; the abort handler closes the stream.
        }
      };

      try {
        for await (const event of engine.run({
          message: body.message,
          history: body.history,
          effort,
          thinking,
          model: body.model,
          signal: clientSignal,
          continueFrom: body.continueFrom,
          interrupted: body.interrupted,
          onRetryNotice: enqueueRetryNotice,
          onToolRetryNotice: enqueueToolRetryNotice,
          onReasoningDelta: enqueueReasoning,
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
          // One normalizer at the boundary: the engine and the adapter have
          // already classified this, so the user-facing classification must
          // not re-guess from an HTTP status and a message string.
          const failure: ChatStreamFailure = chatStreamFailureFromLlmFailure(normalizeLlmFailure(err));
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
