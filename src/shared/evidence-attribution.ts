/**
 * Public-answer rules shared by the market-research passes. These rules make
 * the boundary between reported facts, BOZ's interpretation, and crowd data
 * explicit instead of letting a model present every input as settled fact.
 */
import { buildStocktwitsPulse } from './crowd-pulse.js';
export const WEB_EVIDENCE_CITATION_RULES = [
  'WEB EVIDENCE, ATTRIBUTION, AND CROWD-SIGNAL RULES:',
  '  - For every material claim that relies on web_search or fetch_news, attach a direct Markdown citation using the exact source URL supplied by the tool: [Publisher or article title](URL). Never invent a URL, cite a search-results page, or cite a source that did not support the claim.',
  '  - Attribute one source precisely: write “According to [Source](URL), …”, “[Source](URL) reported …”, or, for a primary source, “[Company/agency](URL) announced/filed …”. Do not turn a headline or snippet into an established fact.',
  '  - Say “Multiple independent reports, including [Source A](URL) and [Source B](URL), indicate …” only when at least two distinct named publishers support the same point. Never say “multiple media says” or imply corroboration from one article.',
  '  - Separate evidence from BOZ’s inference. Use wording such as “Based on those reports and the market data, BOZ’s interpretation is …”. Calibrate uncertainty when sources are incomplete, disagree, or merely report an allegation.',
  '  - When web evidence was used, end with an “Evidence & sources” list containing the 2–4 most decision-relevant linked sources. Do not add a source list when no direct source URL was supplied.',
  '  - Treat crowd data as an observation, not a forecast or consensus. Name the source and sample: “Crowd signal (not a forecast): [StockTwits](URL) showed X% bullish across N labelled messages.” Keep market-wide Fear & Greed separate from ticker-specific StockTwits/Reddit activity, and require price/volume confirmation before acting on either.',
].join('\n');

export interface CrowdSignalInput {
  fear_greed?: {
    value?: number;
    label?: string;
    source?: string;
    source_url?: string;
  } | null;
  stocktwits_data?: {
    bull_ratio?: number;
    bullish?: number;
    bearish?: number;
    total_with_sentiment?: number;
    total_messages?: number;
    source?: string;
    source_url?: string;
  } | null;
  social_buzz?: Array<{
    source?: string;
    mentions?: number;
    window?: string;
    capped?: boolean;
    source_url?: string;
  }> | null;
}

function safeSourceLink(label: string, candidate?: string): string {
  if (!candidate) return label;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? `[${label}](${url.toString()})`
      : label;
  } catch {
    return label;
  }
}

/**
 * Converts raw crowd metrics into wording that states exactly what was
 * measured. It deliberately does not imply that a crowd sample predicts price.
 */
export function formatCrowdSignalEvidence(crowd: CrowdSignalInput): string {
  const observations: string[] = [];
  const fearGreed = crowd.fear_greed;
  if (typeof fearGreed?.value === 'number') {
    const source = safeSourceLink(fearGreed.source || 'Fear & Greed source', fearGreed.source_url);
    const label = fearGreed.label ? ` (${fearGreed.label})` : '';
    observations.push(`market-wide Fear & Greed measured ${fearGreed.value}/100${label} from ${source}`);
  }

  const stocktwits = crowd.stocktwits_data;
  if (stocktwits && (typeof stocktwits.bull_ratio === 'number' || stocktwits.total_with_sentiment != null || stocktwits.bullish != null || stocktwits.bearish != null)) {
    const source = safeSourceLink(stocktwits.source || 'StockTwits', stocktwits.source_url);
    const pulse = buildStocktwitsPulse({
      bullish: stocktwits.bullish ?? null,
      bearish: stocktwits.bearish ?? null,
      total_with_sentiment: stocktwits.total_with_sentiment ?? null,
      total_messages: stocktwits.total_messages ?? null,
      bull_ratio: stocktwits.bull_ratio,
    });
    const sampled = pulse.totalMessages;
    const sample = sampled != null
      ? `${pulse.labelled} labelled messages out of ${sampled} sampled`
      : `${pulse.labelled} labelled messages`;
    const split = ` (${pulse.bullish} bullish / ${pulse.bearish} bearish)`;
    const ratioText = pulse.bullRatio != null ? `${pulse.bullRatio.toFixed(1)}% bullish` : 'no audited bullish share';
    const unlabelled = pulse.neutralShare != null && sampled != null && sampled > 0
      ? `, ${pulse.neutralShare.toFixed(0)}% of the sampled stream unlabelled`
      : '';
    const depth = pulse.confidence !== 'EMPTY' ? `, read confidence ${pulse.confidence}` : '';
    observations.push(`${source} showed ${ratioText} across ${sample}${split}${unlabelled}${depth}`);
  }

  const reddit = crowd.social_buzz?.find((item) => item.source?.toLowerCase() === 'reddit');
  if (typeof reddit?.mentions === 'number') {
    const source = safeSourceLink(reddit.source || 'Reddit', reddit.source_url);
    const window = reddit.window ? ` in the sampled ${reddit.window}` : '';
    observations.push(`${source} returned ${reddit.mentions}${reddit.capped ? '+' : ''} discussion matches${window}`);
  }

  return observations.length
    ? `Crowd signal (not a forecast): ${observations.join('; ')}.`
    : '';
}
