import { NextRequest } from 'next/server';
import { WebChatEngine } from '../chat.engine';
import type { ThoughtEffort } from '@/shared/thought-prompts';

const VALID_EFFORTS: ThoughtEffort[] = ['Low', 'Medium', 'High', 'Extra', 'Max'];

export async function POST(request: NextRequest) {
  let body: {
    message?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    effort?: string;
    thinking?: boolean;
    model?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return new Response('Message is required', { status: 400 });
  }

  const effort: ThoughtEffort =
    body.effort && VALID_EFFORTS.includes(body.effort as ThoughtEffort)
      ? (body.effort as ThoughtEffort)
      : 'Max';
  const thinking = body.thinking !== false; // default true

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const engine = new WebChatEngine();

      try {
        for await (const event of engine.run({
          message,
          history: body.history,
          effort,
          thinking,
          model: typeof body.model === 'string' ? body.model.trim() : undefined,
        })) {
          const payload = JSON.stringify(event.data);
          const sseMessage = `event: ${event.type}\ndata: ${payload}\n\n`;
          controller.enqueue(encoder.encode(sseMessage));
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const sseError = `event: error\ndata: ${JSON.stringify({ message: errorMsg })}\n\n`;
        controller.enqueue(encoder.encode(sseError));
      } finally {
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
