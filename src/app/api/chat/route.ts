import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { LLMAdapter } from '@/services/ai/llm.adapter';

const SYSTEM_PROMPT = `You are BOZ (Behavioral Outlook Zone), a senior financial analyst AI assistant at a top hedge fund. You provide clear, data-driven insights on markets, stocks, and trading strategies.

Your personality:
- Direct and confident, with professional humor
- You cite data and reasoning, never vague hand-waving
- You use contrarian analysis when crowd sentiment is extreme
- You acknowledge uncertainty honestly
- You format responses clearly with bullet points and structure

You can discuss: market analysis, technical indicators, macro economics, risk management, portfolio strategy, specific stock analysis, trading psychology, and Indonesian market (IDX/IHSG).

Keep responses concise but substantive. Use markdown formatting when helpful.`;

export async function POST(request: NextRequest) {
  try {
    const { message, history } = await parseBody<{
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    }>(request);

    if (!message?.trim()) return errorResponse('Message is required', 400);

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
    });

    return jsonResponse({
      response,
      provider: config.aiProvider,
      model: config.aiModel,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


