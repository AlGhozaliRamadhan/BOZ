import axios from 'axios';
import Parser from 'rss-parser';
import { yahooFinance } from '../market/yahoo.service.js';
import { newsFetchService } from '../news/news.fetch.service.js';
import { htmlToPlainText } from '../../utils/html.js';
import { websiteRagService } from './website.rag.service.js';

export interface WebSearchResult {
  title:        string;
  url:          string | null;
  snippet:      string;
  publisher?:   string;
  publisherUrl?: string | null;
}

const SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Build a live, public Google News RSS endpoint for a query. */
export function buildGoogleNewsRssUrl(query: string): string {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';
}

/** Keep tool output source-linked and readable inside the expandable Thought. */
export function formatWebSearchResults(query: string, results: WebSearchResult[]): string {
  const lines = results.slice(0, 12).map((result) => {
    const title = result.url ? '[' + result.title + '](' + result.url + ')' : result.title;
    return [
      '- ' + title,
      result.url ? '  URL: ' + result.url : '',
      result.publisher ? '  Publisher: ' + result.publisher : '',
      result.publisherUrl ? '  Publisher URL: ' + result.publisherUrl : '',
      result.snippet ? '  Summary: ' + result.snippet.slice(0, 320) : '',
    ].filter(Boolean).join('\n');
  });

  return 'Web search results for "' + query + '":\n' + lines.join('\n');
}

function plainText(value: unknown, maxLength: number): string {
  return htmlToPlainText(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeRssXml(xml: string): string {
  return xml.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+|[A-Za-z][A-Za-z\d]*);)/g,
    '&amp;',
  );
}

function extractGoogleNewsPublishers(xml: string): Array<{ publisher?: string; publisherUrl?: string }> {
  const itemBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  return itemBlocks.map((itemBlock) => {
    const source = itemBlock[1].match(/<source\b[^>]*\burl=(['\"])(.*?)\1[^>]*>([\s\S]*?)<\/source>/i);
    if (!source) return {};
    return {
      publisher: plainText(source[3], 160),
      publisherUrl: source[2].replace(/&amp;/g, '&'),
    };
  });
}

// Decode a DuckDuckGo HTML redirect link (//duckduckgo.com/l/?uddg=<url>&rut=...)
// into the real target URL. Falls back to the raw href when not a redirect.
function decodeDdgUrl(raw: string): string | null {
  if (!raw) return null;
  let href = raw.trim();
  if (href.startsWith('//')) href = 'https:' + href;
  const uddg = href.match(/[?&]uddg=([^&]+)/);
  if (uddg && uddg[1]) {
    try { return decodeURIComponent(uddg[1]); } catch { /* fall through */ }
  }
  return href.startsWith('http') ? href : null;
}

export class WebSearchService {
  /**
   * Performs a multi-tiered web search.
   * Tier 1: Google News RSS (live, source-linked financial and market news)
   * Tier 2: DuckDuckGo HTML scrape
   * Tier 3: DuckDuckGo Instant Answer JSON
   * Tier 4: Yahoo Finance news search
   * Tier 5: Direct Indonesian RSS scrape for IHSG-related queries
   */
  // Last successful result set, with URLs, so deepSearch can fetch the top
  // pages and run keyword RAG over their full text. Populated by search().
  private lastResults: WebSearchResult[] = [];
  private readonly rssParser = new Parser({
    customFields: { item: [['source', 'source']] },
  });

  private async searchGoogleNews(query: string): Promise<WebSearchResult[]> {
    const response = await axios.get<string>(buildGoogleNewsRssUrl(query), {
      headers: {
        'User-Agent': SEARCH_USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 8000,
      responseType: 'text',
      maxContentLength: 1_000_000,
      maxBodyLength: 1_000_000,
      validateStatus: status => status >= 200 && status < 300,
    });
    const feed = await this.rssParser.parseString(sanitizeRssXml(response.data));
    const publishers = extractGoogleNewsPublishers(response.data);
    const seenTitles = new Set<string>();

    return (feed.items ?? [])
      .map((item: any, index) => ({
        title: plainText(item.title, 500),
        url: item.link?.startsWith('http') ? item.link : null,
        snippet: plainText(item.contentSnippet ?? item.content, 500),
        publisher: plainText(item.source ?? publishers[index]?.publisher, 160) || undefined,
        publisherUrl: publishers[index]?.publisherUrl ?? null,
      }))
      .filter((item) => {
        const key = item.title.toLowerCase();
        if (!item.title || seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      })
      .slice(0, 12);
  }

  public async search(query: string): Promise<string> {
    const normalizedQuery = query.trim();
    this.lastResults = [];

    // Tier 1: Google News RSS remains available when the DuckDuckGo TLS
    // endpoint is unavailable, and each item retains its source URL.
    try {
      const results = await this.searchGoogleNews(normalizedQuery);
      if (results.length > 0) {
        this.lastResults = results;
        return formatWebSearchResults(normalizedQuery, results);
      }
    } catch { /* cascade */ }

    // Tier 2: DuckDuckGo HTML scrape — much richer than the JSON Instant Answer API
    try {
      const encoded = encodeURIComponent(query);
      const res = await axios.get(
        `https://html.duckduckgo.com/html/?q=${encoded}`,
        {
          headers: {
            'User-Agent': SEARCH_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 10000,
          responseType: 'text',
          maxContentLength: 1_000_000,
          maxBodyLength: 1_000_000,
        },
      );
      const html: string = res.data ?? '';
      const results: string[] = [];
      // Track the raw result URLs so deepSearch can fetch the top pages via RAG.
      this.lastResults = [];

      // Extract result snippets — DDG HTML uses class="result__snippet"
      const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const titleRe   = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
      const urlRe     = /class="result__a"[^>]*href="([^"]+)"/g;
      const titles:   string[] = [];
      const snippets: string[] = [];
      const urls:     string[] = [];

      let m: RegExpExecArray | null;
      while ((m = titleRe.exec(html)) !== null) {
        const t = htmlToPlainText(m[1]);
        if (t) titles.push(t);
      }
      while ((m = snippetRe.exec(html)) !== null) {
        const s = htmlToPlainText(m[1]);
        if (s) snippets.push(s);
      }
      while ((m = urlRe.exec(html)) !== null) {
        const u = decodeDdgUrl(m[1]);
        if (u) urls.push(u);
      }

      const count = Math.min(titles.length, snippets.length, 12);
      for (let i = 0; i < count; i++) {
        const sourceUrl = urls[i] ?? null;
        results.push([
          `- ${sourceUrl ? `[${titles[i]}](${sourceUrl})` : titles[i]}`,
          sourceUrl ? `  URL: ${sourceUrl}` : '',
          `  Summary: ${snippets[i].slice(0, 320)}`,
        ].filter(Boolean).join('\n'));
        this.lastResults.push({
          title: titles[i],
          url: sourceUrl,
          snippet: snippets[i],
        });
      }
      // If only titles available (no snippets parsed), use titles alone
      if (results.length === 0 && titles.length >= 3) {
        for (const t of titles.slice(0, 12)) {
          results.push(`- ${t}`);
          this.lastResults.push({ title: t, url: null, snippet: '' });
        }
      }

      if (results.length >= 2) {
        return `Web search results for "${query}":\n${results.join('\n')}`;
      }
    } catch { /* cascade */ }

    // Tier 3: DuckDuckGo Instant Answer JSON (good for entity lookups)
    try {
      const encoded = encodeURIComponent(query);
      const res = await axios.get(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': SEARCH_USER_AGENT }, timeout: 8000, maxContentLength: 1_000_000, maxBodyLength: 1_000_000 },
      );
      const data = res.data;
      const results: string[] = [];
      if (data.AbstractText?.trim()) results.push(`- ${data.AbstractText.trim().slice(0, 300)}`);
      if (data.Answer?.trim()) results.push(`- ${data.Answer.trim().slice(0, 200)}`);
      for (const topic of (data.RelatedTopics ?? []).slice(0, 12)) {
        const text = topic.Text ?? topic.Result;
        if (text?.trim()) results.push(`- ${String(text).trim().slice(0, 200)}`);
        for (const sub of (topic.Topics ?? []).slice(0, 2)) {
          if (sub.Text?.trim()) results.push(`- ${String(sub.Text).trim().slice(0, 200)}`);
        }
      }
      if (results.length >= 2) {
        return `Web search results for "${query}":\n${results.slice(0, 12).join('\n')}`;
      }
    } catch { /* cascade */ }

    // Tier 4: Yahoo Finance news search (best for financial / ticker queries)
    try {
      const searchRes = await yahooFinance.search(query, { newsCount: 12, quotesCount: 0 });
      const headlines = (searchRes.news ?? [])
        .slice(0, 12)
        .map((n: any) => ({
          title: plainText(n.title, 500),
          url: typeof n.link === 'string' && n.link.startsWith('http') ? n.link : null,
          snippet: plainText(n.summary ?? n.publisher ?? '', 500),
        }))
        .filter((item) => item.title);
      if (headlines.length >= 1) {
        this.lastResults = headlines;
        return formatWebSearchResults(normalizedQuery, headlines);
      }
    } catch { /* cascade */ }

    // Tier 5: Direct Indonesian RSS scrape for IHSG-related queries
    const isIndonesianQuery = /ihsg|idx|bursa|saham|jkse|indonesia|rupiah|bi rate/i.test(query);
    if (isIndonesianQuery) {
      try {
        const indonesiaItems = await newsFetchService.fetchIndonesiaNews();
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const relevant = indonesiaItems
          .filter(n => {
            const blob = `${n.title} ${n.details}`.toLowerCase();
            return queryWords.some(w => blob.includes(w));
          })
          .slice(0, 8)
          .map(n => `- ${n.title} (${n.source})`);
        if (relevant.length >= 1) {
          return `Indonesian market news for "${query}":\n${relevant.join('\n')}`;
        }
        // If no keyword match, return top Indonesian headlines as context
        const topItems = indonesiaItems.slice(0, 6).map(n => `- ${n.title} (${n.source})`);
        if (topItems.length >= 1) {
          return `Top Indonesian market headlines (no exact match for "${query}"):\n${topItems.join('\n')}`;
        }
      } catch { /* cascade */ }
    }

    return `Web search for "${query}" returned no results across all search providers. The data may not be available online right now — try a broader or simpler query.`;
  }

  /**
   * Effort-scaled deep web research.
   * Runs the normal search() to get candidate links, then fetches the top
   * `depth` pages and extracts their most relevant chunks via keyword RAG.
   * Higher effort tiers read more pages and more chunks per page, so the model
   * gets real source text instead of just headlines.
   */
  public async deepSearch(query: string, depth: number = 2): Promise<string> {
    // Tool calls execute concurrently. Use a request-scoped search instance so
    // one query can never overwrite another query's candidate URLs.
    const scopedSearch = new WebSearchService();
    const baseResults = await scopedSearch.search(query);

    // If we have URLs from a live provider, fetch and RAG the top pages.
    const candidates = scopedSearch.lastResults.filter(r => r.url);
    if (candidates.length === 0) {
      return baseResults;
    }

    const fetchCount = Math.min(depth, candidates.length, 6);
    const topK = depth >= 5 ? 4 : depth >= 3 ? 3 : 2;

    const sections: string[] = [];
    const fetchQueue = candidates.slice(0, fetchCount);

    // Fetch top pages concurrently.
    const pages = await Promise.all(
      fetchQueue.map(async (c) => {
        try {
          const text = await websiteRagService.readAndExtract(c.url!, query, topK);
          return { title: c.title, url: c.url, text };
        } catch {
          return { title: c.title, url: c.url, text: '' };
        }
      }),
    );

    for (const p of pages) {
      if (p.text && !p.text.startsWith('Failed') && !p.text.startsWith('Error') && !p.text.startsWith('No readable')) {
        sections.push(`## ${p.title}\nSource: ${p.url}\n${p.text}`);
      }
    }

    if (sections.length === 0) {
      return baseResults;
    }

    return [
      baseResults,
      '',
      `Deep web research for "${query}" (${sections.length} source${sections.length === 1 ? '' : 's'} analyzed):`,
      '',
      ...sections,
    ].join('\n\n');
  }
}

export const webSearchService = new WebSearchService();
