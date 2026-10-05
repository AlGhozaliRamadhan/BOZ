import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

export function formatContent(content: string): string {
  try {
    const rawHtml = marked.parse(content, { breaks: true, async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  } catch (e) {
    return DOMPurify.sanitize(content);
  }
}

export function formatMessageTime(timestamp?: number): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}
