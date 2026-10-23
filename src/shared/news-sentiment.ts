// ─── shared/news-sentiment.ts ─────────────────────────────────────────────────
// Headline → (bullish | bearish | neutral) classifier for the dashboard
// calendar. On the dashboard, green/red now means SENTIMENT — whether a day's
// watchlist headlines lean bullish or bearish — never market open/closed.
//
// Deliberately a small deterministic lexicon: no network, no model, no API
// keys. The month news route applies it once per headline at bucket time, so
// saved day payloads always carry the decided tone and the client never has
// to re-decide it. English finance headlines only (the feeds are fetched with
// hl=en-US); a miss reads neutral, which is the honest answer for headlines
// whose direction for the company is unknowable from one phrase.
//
// Macro terms (Fed, CPI, tariffs, recession…) are excluded on purpose:
// per-favourite feeds return plenty of macro headlines, and whether macro
// news is bullish for a given company depends on the company — guessing a
// colour there would lie about the meaning green/red now carries.

/** Tone of one headline. `neutral` includes "unreadable/insufficient signal". */
export type HeadlineSentiment = 'bullish' | 'bearish' | 'neutral';

/**
 * Bullish signal phrases. Phrases (not bare verbs) wherever a bare word could
 * flip on common contrarian sentences — e.g. bare "cut" would read the
 * bullish "cuts costs" as bearish, so "cut" only counts towards its own
 * objects (guidance, dividend, jobs…).
 */
const BULLISH_PATTERNS: RegExp[] = [
  /\bbeats?\b/,
  /\btop(?:ped|s)\b/,
  /\bcrush(?:es|ed)?\b/,
  /\bsurge[ds]?\b/,
  /\bsoar(?:s|ed|ing)?\b/,
  /\bskyrocket(?:s|ed|ing)?\b/,
  /\bspik(?:e|es|ed|ing)\b/,
  /\brall(?:y|ies|ied)\b/,
  /\bjump(?:s|ed)?\b/,
  /\brise(?:s)?\b|\brose\b/,
  /\bgain(?:s|ed)?\b/,
  /\bclimb(?:s|ed|ing)?\b/,
  /\bgrow(?:s|ing)?\b/,
  /\bdoubl(?:e|es|ed|ing)\b/,
  /\bboost(?:s|ed|ing)?\b/,
  /\brecord (?:high|revenue|profit|earnings|sales|quarter)\b/,
  /\b(?:all-?time|historic)\b[^.;]{0,20}\bhigh\b/,
  /\bstrong (?:demand|quarter|results|earnings|sales|growth|start|debut)\b/,
  /\bupgrad(?:e|es|ed|ing)\b/,
  /\bbuy(?:s)? rating\b/,
  /\brais(?:e|es|ed|ing)\b[^.;]{0,40}\b(?:guidance|forecast|outlook|estimates?|rating|dividend|price target|target)\b/,
  /\blift(?:s|ed)?\b[^.;]{0,40}\b(?:guidance|forecast|outlook|target)\b/,
  /\bdividend (?:increase|hike)\b|\bspecial dividend\b/,
  /\bbuybacks?\b/,
  /\bwon\b|\bwins?\b[^.;]{0,40}\b(?:contract|order|deal|tender|approval|license|grant|bid)\b/,
  /\b(?:signs?|signed|secures?|secured|inked|land(?:s|ed)?)\b[^.;]{0,30}\b(?:deal|contract|agreement|partnership|order|pact)\b/,
  /\bapprov(?:e|es|ed|al)\b/,
  /\bexpands?\b|\bexpansion\b/,
  /\bbreak(?:s|ing)? out\b|\bbreakout\b/,
  /\brecover(?:y|s|ed|ing)?\b|\bturnaround\b/,
  /\bbullish\b/,
];

/**
 * Bearish signal phrases, same precision standard.
 */
const BEARISH_PATTERNS: RegExp[] = [
  /\bplummet(?:s|ed|ing)?\b/,
  /\bplunge[ds]?\b/,
  /\btumble[ds]?\b/,
  /\bslump(?:s|ed)?\b/,
  /\bskid(?:s|ded)?\b/,
  /\bsink(?:s|ing)?\b|\bsank\b/,
  /\bcrash(?:es|ed)?\b/,
  /\bsell[- ]?offs?\b/,
  /\bwip(?:e|es|ed) out\b/,
  /\bfalls?\b|\bfell\b|\bfalling\b|\bfallen\b/,
  /\bdrops?\b|\bdropped\b/,
  /\bslid(?:e|es|ing)?\b|\bslid\b/,
  /\bdeclin(?:e|es|ed|ing)\b/,
  /\bmiss(?:es|ed)?\b/,
  /\bfalls? short\b/,
  /\bdowngrad(?:e|es|ed|ing)\b/,
  /\bsell(?:s)? rating\b/,
  /\bcuts?\b[^.;]{0,30}\b(?:guidance|forecast|outlook|estimates?|price targets?|dividend|jobs|staff|workforce|pay)\b/,
  /\blowere[ds]?\b[^.;]{0,30}\b(?:guidance|forecast|outlook|estimates?|target)\b/,
  /\btrim(?:s|med|ming)?\b[^.;]{0,30}\b(?:guidance|forecast|outlook|estimates?|target)\b/,
  /\bwarn(?:s|ed|ings?)?\b/,
  /\blawsuit\b|\bsue[ds]?\b|\bprobe[ds]?\b/,
  /\binvestigat(?:e|es|ed|ion|ions|ing)\b/,
  /\bfraud\b|\bfines?\b|\bfined\b/,
  /\brecall(?:s|ed|ing)?\b/,
  /\bbankrupt(?:cy)?\b|\bdefault(?:s|ed)?\b|\bliquidat(?:e|ed|es|ion)\b/,
  /\blay(?:offs?|ing)\b|\blayoff\b/,
  /\bresign(?:s|ed|ation)?\b|\bquits?\b/,
  /\bweak(?:ens?|ened|ening)?\b|\bweakened\b/,
  /\bslowdown\b|\bslows?\b|\bdeepen(?:s|ed)?\b/,
  /\bdeteriorat(?:e|es|ed|ing|ion)\b/,
  /\bbearish\b|\bdownturn\b|\brecession\b/,
  /\blo(?:ss|ses)\b/,
  /\bsuspend(?:s|ed)?\b/,
];

/**
 * Classify one headline by count of bullish vs bearish signal phrases:
 * strictly more bullish matches → bullish, strictly more bearish matches →
 * bearish, anything else (no match, or both sides row-cancel) → neutral.
 * The row-cancel is a feature, not a bug: "Shares fall as profit jumps"
 * must NOT confidently claim either side.
 */
export function classifyHeadline(raw: string): HeadlineSentiment {
  const title = (raw ?? '').toLowerCase();
  if (!title.trim()) return 'neutral';
  let bullish = 0;
  let bearish = 0;
  for (const pattern of BULLISH_PATTERNS) if (pattern.test(title)) bullish++;
  for (const pattern of BEARISH_PATTERNS) if (pattern.test(title)) bearish++;
  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'neutral';
}

/** One decisive glance: number of bullish and bearish matches for tooltip lines. */
export function headlineToneCounts(
  items: ReadonlyArray<{ sentiment?: string }>,
): { bullish: number; bearish: number } {
  let bullish = 0;
  let bearish = 0;
  for (const item of items) {
    if (item?.sentiment === 'bullish') bullish++;
    else if (item?.sentiment === 'bearish') bearish++;
  }
  return { bullish, bearish };
}
