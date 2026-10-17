const COMPLETE_PRIVATE_BLOCKS = [
  /<thinking>[\s\S]*?<\/thinking>\s*/gi,
  /<think>[\s\S]*?<\/think>\s*/gi,
  /<thought>[\s\S]*?<\/thought>\s*/gi,
  /<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>\s*/gi,
];

const OPEN_PRIVATE_BLOCK = /<(?:thinking|think|thought)>|<\|begin_of_thought\|>/i;
const CLOSE_PRIVATE_BLOCK = /<\/(?:thinking|think|thought)>|<\|end_of_thought\|>/i;

const PRIVATE_START_TAGS = ['<thinking>', '<think>', '<thought>', '<|begin_of_thought|>'];
const PRIVATE_END_TAGS = ['</thinking>', '</think>', '</thought>', '<|end_of_thought|>'];

function findFirstTag(text: string, tags: string[]): { index: number; tag: string } | null {
  const lowerText = text.toLowerCase();
  let match: { index: number; tag: string } | null = null;

  for (const tag of tags) {
    const index = lowerText.indexOf(tag);
    if (index !== -1 && (!match || index < match.index)) match = { index, tag };
  }

  return match;
}

function findPartialTagStart(text: string, tags: string[]): number {
  const start = text.lastIndexOf('<');
  if (start === -1) return -1;

  const candidate = text.slice(start).toLowerCase();
  return tags.some(tag => tag.startsWith(candidate)) ? start : -1;
}

/**
 * Splits a streamed model response into public text and reasoning.
 *
 * Reasoning blocks can arrive over several chunks, so this cannot work by
 * filtering after a chunk has been shown. It fails closed on the boundary
 * instead: text inside a block — including an unterminated one — is never
 * classified as public, because leaking a scratchpad tail into the answer is
 * far worse than dropping reasoning.
 *
 * The split matters because BOZ now SHOWS reasoning. It used to be discarded,
 * which is why this class only ever needed to return the public half.
 */
export class PrivateReasoningStreamFilter {
  private buffer = '';
  private insidePrivateBlock = false;
  private privateText = '';
  private sawPartialOpen = false;

  /**
   * Feed one streamed chunk.
   *
   * @returns public text safe to stream as the answer, and the reasoning seen
   *   so far. Reasoning accumulates across calls and is cleared on each read,
   *   so a caller that ignores the second half behaves exactly as before.
   */
  push(chunk: string): { publicText: string; reasoning: string } {
    this.buffer += chunk;
    let publicText = '';

    while (this.buffer) {
      if (this.insidePrivateBlock) {
        const end = findFirstTag(this.buffer, PRIVATE_END_TAGS);
        if (end) {
          // Everything up to the closing tag is reasoning.
          this.privateText += this.buffer.slice(0, end.index);
          this.buffer = this.buffer.slice(end.index + end.tag.length);
          this.insidePrivateBlock = false;
          continue;
        }

        const partialEnd = findPartialTagStart(this.buffer, PRIVATE_END_TAGS);
        // Whatever cannot be part of a tag is settled reasoning and can go.
        this.privateText += partialEnd === -1 ? this.buffer : this.buffer.slice(0, partialEnd);
        this.buffer = partialEnd === -1 ? '' : this.buffer.slice(partialEnd);
        break;
      }

      const start = findFirstTag(this.buffer, PRIVATE_START_TAGS);
      const end = findFirstTag(this.buffer, PRIVATE_END_TAGS);
      const nextTag = !start || (end && end.index < start.index) ? end : start;

      if (nextTag) {
        if (nextTag === end) {
          // A provider prefill can start inside reasoning and stream the
          // closing tag later. Treat the prefix as reasoning, not answer.
          this.privateText += this.buffer.slice(0, nextTag.index);
          this.buffer = this.buffer.slice(nextTag.index + nextTag.tag.length);
        } else {
          publicText += this.buffer.slice(0, nextTag.index);
          this.buffer = this.buffer.slice(nextTag.index + nextTag.tag.length);
          this.insidePrivateBlock = true;
        }
        continue;
      }

      const partialStart = findPartialTagStart(this.buffer, PRIVATE_START_TAGS);
      const partialEnd = findPartialTagStart(this.buffer, PRIVATE_END_TAGS);
      if (partialEnd !== -1 && (partialStart === -1 || partialEnd < partialStart)) {
        // Text before a possible orphaned closing tag is reasoning.
        this.privateText += this.buffer.slice(0, partialEnd);
        this.buffer = this.buffer.slice(partialEnd);
        break;
      }
      if (partialStart !== -1) {
        publicText += this.buffer.slice(0, partialStart);
        this.buffer = this.buffer.slice(partialStart);
        // Remembered so `finish()` can route the withheld suffix to reasoning
        // rather than dropping it: the block may still be perfectly good text.
        this.sawPartialOpen = true;
        break;
      }

      publicText += this.buffer;
      this.buffer = '';
    }

    const reasoning = this.privateText;
    this.privateText = '';
    return { publicText, reasoning };
  }

  /**
   * Settles the stream.
   *
   * A buffered suffix is either an incomplete private tag or reasoning still in
   * flight. Both go to the reasoning channel — never to the answer — so a
   * truncated block still shows the user what the model was working through.
   */
  finish(): { publicText: string; reasoning: string } {
    // A buffered suffix after a partial OPEN tag is reasoning the stream never
    // closed. It goes to the thought panel rather than being dropped, because
    // dropping it is what left the panel empty before this was made visible.
    const pendingIsReasoning = this.insidePrivateBlock || this.sawPartialOpen;
    const reasoning = this.privateText + (pendingIsReasoning ? this.buffer : '');
    this.buffer = '';
    this.insidePrivateBlock = false;
    this.privateText = '';
    this.sawPartialOpen = false;
    return { publicText: '', reasoning };
  }
}

/**
 * The model's own working, pulled out of one COMPLETE response.
 *
 * `PrivateReasoningStreamFilter` is built for a stream, so a one-shot message
 * needs this: feed the whole text, then settle, so an unterminated block is
 * treated as reasoning rather than dropped or mistaken for the answer.
 *
 * Used on tool-calling turns, where the adapter nulls `content` and the inline
 * block would otherwise disappear with it — which is why the panel used to open
 * on the tool call with nothing explaining what the model was trying to settle.
 */
export function extractPrivateReasoning(text: string): string {
  if (!text) return '';
  const filter = new PrivateReasoningStreamFilter();
  const first = filter.push(text);
  const rest = filter.finish();
  return `${first.reasoning}${rest.reasoning}`.trim();
}

/**
 * Removes private model deliberation and generic hand-off filler from text that
 * is about to be shown to a user. Different reasoning providers use different
 * tags and may leave a tag unclosed when output is truncated.
 */
export function sanitizeAssistantOutput(text: string): string {
  if (!text) return '';

  let cleaned = text.replace(/^\uFEFF/, '');

  // A provider can omit the opening tag when it was supplied as a prefill.
  // Everything before the orphaned closing tag is private.
  const orphanClose = cleaned.search(CLOSE_PRIVATE_BLOCK);
  const firstOpen = cleaned.search(OPEN_PRIVATE_BLOCK);
  if (orphanClose !== -1 && (firstOpen === -1 || orphanClose < firstOpen)) {
    const closeMatch = cleaned.slice(orphanClose).match(CLOSE_PRIVATE_BLOCK);
    cleaned = cleaned.slice(orphanClose + (closeMatch?.[0].length ?? 0));
  }

  for (const pattern of COMPLETE_PRIVATE_BLOCKS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Fail closed for a truncated private block instead of exposing a scratchpad.
  const unclosedOpen = cleaned.search(OPEN_PRIVATE_BLOCK);
  if (unclosedOpen !== -1) cleaned = cleaned.slice(0, unclosedOpen);

  cleaned = cleaned
    .replace(/<\/?(?:thinking|think|thought)>/gi, '')
    .replace(/<\|(?:begin|end)_of_thought\|>/gi, '')
    .replace(/^\s*Thinking Process:\s*(?:\n\s*\d+\.?)?\s*/i, '')
    .replace(/^\s*\[(?:Your )?tool call or final answer\]\s*/gim, '')
    .replace(/^\s*(?:No additional tool call required|No further tool call needed;? analysis complete)\.?\s*/gim, '')
    .trim();

  // Lead with the conclusion, not an announcement that output follows.
  cleaned = cleaned.replace(
    /^(?:(?:okay|ok|sure|certainly)[,!.:\s-]*)?(?:here(?:'s| is)\s+(?:the|your|my)\s+(?:output|answer|analysis|verdict|response|result)|(?:the|my)\s+(?:output|answer|analysis|verdict|response|result)\s+is)\s*[:.!-]*\s*/i,
    '',
  ).trim();

  // Keep the real markdown answer when a model echoes prompt-planning prose.
  const headingIndex = cleaned.search(/(?:^|\n)#{1,3}\s+\S+/);
  if (headingIndex > 0) {
    const preamble = cleaned.slice(0, headingIndex).toLowerCase();
    if (
      preamble.includes('we need to') ||
      preamble.includes('we must') ||
      preamble.includes('according to the system') ||
      preamble.includes('the user is asking') ||
      preamble.includes('the user gave') ||
      preamble.includes('the instruction') ||
      preamble.includes('this is an independent scenario') ||
      preamble.includes("let's craft") ||
      preamble.includes("let's produce")
    ) {
      cleaned = cleaned.slice(headingIndex).trim();
    }
  }

  return cleaned;
}

export interface AnalysisPassOutput {
  analysis: string;
  answer: string;
}

const ANALYSIS_NOTE = /<analysis_note(?:\s[^>]*)?>([\s\S]*?)(?:<\/analysis_note>|(?=<answer(?:\s[^>]*)?>)|$)/i;
const ANSWER_NOTE = /<answer(?:\s[^>]*)?>([\s\S]*?)(?:<\/answer>|$)/i;

function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const slice = text.slice(0, Math.max(0, maxLength - 1));
  const lastBoundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  const bounded = lastBoundary > maxLength * 0.75 ? slice.slice(0, lastBoundary) : slice;
  return `${bounded.trimEnd()}…`;
}

function formatAnalysisActivity(text: string, label: string, maxLength: number): string {
  const cleaned = sanitizeAssistantOutput(text)
    .replace(/<\/?(?:analysis_note|answer)(?:\s[^>]*)?>/gi, '')
    .replace(/^\s*(?:public\s+)?analysis(?:\s+note)?\s*:\s*/i, '')
    .trim();

  if (!cleaned) return '';
  return `**${label}**\n\n${truncateAtWord(cleaned, maxLength)}`;
}

/**
 * Builds a substantial, user-readable account of what an analysis pass found.
 * It is derived from a sanitized candidate answer, never native provider
 * reasoning or a private scratchpad. This remains as a fallback for providers
 * that do not follow the structured analysis-pass envelope.
 */
export function summarizeAnalysisActivity(text: string, label: string, maxLength = 2200): string {
  const cleaned = sanitizeAssistantOutput(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\/?(?:analysis_note|answer)(?:\s[^>]*)?>/gi, '');

  const usefulLines = cleaned
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length >= 12)
    .filter(line => !/^\|.*\|$/.test(line))
    .filter(line => !/^Open Full .* Dashboard/i.test(line));

  const excerpt = usefulLines.slice(0, 12).join('\n\n').trim();
  if (!excerpt) return '';

  return formatAnalysisActivity(excerpt, label, maxLength);
}

/**
 * Splits the public analysis note from the concise answer produced by an AI
 * pass. The note powers the expandable "AI analysis" timeline; only `answer`
 * is eligible to become the chat response.
 */
export function parseAnalysisPassOutput(
  text: string,
  label: string,
  maxAnalysisLength = 2200,
): AnalysisPassOutput {
  const cleaned = sanitizeAssistantOutput(text);
  if (!cleaned) return { analysis: '', answer: '' };

  const analysisMatch = cleaned.match(ANALYSIS_NOTE);
  const answerMatch = cleaned.match(ANSWER_NOTE);

  const withoutAnalysis = cleaned
    .replace(ANALYSIS_NOTE, '')
    .replace(/<\/?analysis_note(?:\s[^>]*)?>/gi, '')
    .trim();

  const answerSource = answerMatch?.[1]
    ?? withoutAnalysis.replace(/<\/?answer(?:\s[^>]*)?>/gi, '').trim()
    ?? '';
  const answer = sanitizeAssistantOutput(answerSource)
    || sanitizeAssistantOutput(analysisMatch?.[1] ?? '');

  const analysisSource = analysisMatch?.[1] ?? answer;
  const analysis = analysisMatch
    ? formatAnalysisActivity(analysisSource, label, maxAnalysisLength)
    : summarizeAnalysisActivity(analysisSource, label, maxAnalysisLength);

  return { analysis, answer };
}
