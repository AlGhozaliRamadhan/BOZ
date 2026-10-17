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

/**
 * When an answer actually landed: day, month, year, with the time of day.
 *
 * The footer used to print generation telemetry — estimated tokens, word count,
 * total duration, time to first token, tokens per second. Those are numbers
 * about how BOZ ran, sitting where the reader expects to learn something about
 * the answer, and the estimates were explicitly labelled as guesses. A real
 * date answers the question a reader actually has about an old answer ("when did
 * you tell me this?"), and it is a fact rather than an estimate.
 *
 * Fixed field order and an explicit UTC time so the stamp is the same fact in
 * every locale, with the reader's own rendering in the tooltip.
 */
export function formatMessageDate(timestamp?: number): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const at = new Date(timestamp);
  const day = String(at.getDate()).padStart(2, '0');
  const month = at.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = at.getUTCFullYear();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(at);
  return `${day} ${month} ${year}, ${time} UTC`;
}
