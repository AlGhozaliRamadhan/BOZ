import DOMPurify from 'isomorphic-dompurify';

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#x27': "'",
};

/** Convert untrusted HTML to normalized plain text without recursive entity decoding. */
export function htmlToPlainText(value: string): string {
  const decodedOnce = value.replace(
    /&(amp|lt|gt|quot|apos|#39|#x27);/gi,
    (entity) => HTML_ENTITIES[entity.slice(1, -1).toLowerCase()] ?? entity,
  );

  return DOMPurify.sanitize(decodedOnce, {
    ALLOWED_TAGS: [],
    FORBID_TAGS: ['script', 'style'],
  }).replace(/\s+/g, ' ').trim();
}
