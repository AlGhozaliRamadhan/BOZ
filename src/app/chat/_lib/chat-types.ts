import type { AssistantMessageMetrics } from './chat-message-metrics';
import type { ThoughtStep } from './chat-stream-manager';
import type { ChatGenerationStatus } from '@/shared/chat-generation-status';
import type { ToolResult } from '@/shared/chat-tool-results';

export interface TickerSuggestion {
  symbol: string;
  name: string;
  exchange?: string;
  command?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: number;
  metrics?: AssistantMessageMetrics;
  data?: any;
  type?: 'intraday' | 'longterm' | 'newsintel' | 'chat';
  /**
 * The thinking stream, in the order it happened.
 *
 * Reasoning and tool activity share one chronological list so the panel reads
 * as a narrative — thought, tool, result, reaction — rather than as two
 * unrelated widgets. BOZ authors nothing here: every entry is either the
 * model's own reasoning or a tool call it actually made.
 */
  steps?: ThoughtStep[];
  tools?: ToolResult[];
  suggestions?: TickerSuggestion[];
  status?: ChatGenerationStatus;
  /**
   * Raw model output captured before a generation ended short of a final
   * answer (error, Stop, reload). `content` is the reader-facing bubble, which
   * appends BOZ's "Response paused" notice; this is the exact text the model
   * had produced, kept separate so Continue can resume it without feeding the
   * notice back to the model.
   */
  partial?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  status?: ChatGenerationStatus;
}

export interface MarketQuote {
  text: string;
  author: string;
}
