import type { AssistantMessageMetrics } from './chat-message-metrics';
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
  thoughts?: string[];
  tools?: ToolResult[];
  suggestions?: TickerSuggestion[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface MarketQuote {
  text: string;
  author: string;
}
