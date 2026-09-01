import { NextRequest } from 'next/server';
import {
  jsonResponse,
  errorResponse,
  parseBody,
  requestBodyErrorResponse,
  validateChatRequestBody,
} from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { LLMAdapter } from '@/services/ai/llm.adapter';
import { chatWorkloadGate } from '@/services/security/workload-gate';

const SYSTEM_PROMPT = `You are BOZ (Behavioral Outlook Zone), an elite AI market assistant and quantitative analyst.
You think like a hedge fund analyst — skeptical, data-driven, always asking "is this enough?"

CONTRARIAN ANALYSIS:
- StockTwits >70% bullish = caution (retail euphoria precedes reversals)
- StockTwits <30% bullish = buy signal (panic = opportunity)
- Fear & Greed >75 = reduce long confidence
- Fear & Greed <25 = strong buy signal

OUTPUT FORMAT:
- Reply in a natural, conversational style. Direct, confident, professional.
- Use rich markdown formatting: **bold**, headers, bullet lists, tables, code blocks.
- For stock recommendations: rank your picks, give entry zone, stop-loss, and reasoning.
- Cite data and reasoning, never vague hand-waving.
- Acknowledge uncertainty honestly.
- Rarely use emojis (minimize emoji usage).`;

export async function POST(request: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const body = await parseBody<unknown>(request);
    const { message, history, model } = validateChatRequestBody(body);
    release = chatWorkloadGate.tryAcquire();
    if (!release) return errorResponse('Too many chat requests are already running', 429);

    const llm = new LLMAdapter();
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add conversation history if provided
    if (history?.length) {
      for (const msg of history.slice(-10)) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: message });

    const response = await llm.callText({
      messages,
      temperature: 0.5,
      maxTokens: 2000,
      model,
    });

    return jsonResponse({
      response,
      provider: config.aiProvider,
      model: model ?? config.aiModel,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const bodyError = requestBodyErrorResponse(err);
    if (bodyError) return bodyError;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  } finally {
    release?.();
  }
}


