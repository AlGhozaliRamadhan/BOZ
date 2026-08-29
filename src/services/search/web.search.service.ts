import axios from 'axios';
import { yahooFinance } from '../market/yahoo.service.js';
import { newsFetchService } from '../news/news.fetch.service.js';
import { htmlToPlainText } from '../../utils/html.js';
import { websiteRagService } from './website.rag.service.js';

export interface WebSearchResult {
  title:   string;
  url:     string | null;
  snippet: string;
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
   * Tier 1: DuckDuckGo HTML scrape
   * Tier 2: DuckDuckGo Instant Answer JSON
   * Tier 3: Yahoo Finance news search
   * Tier 4: Direct Indonesian RSS scrape for IHSG-related queries
   */
  // Last successful DDG result set, with URLs, so deepSearch can fetch the top
  // pages and run keyword RAG over their full text. Populated by search().
  private lastResults: WebSearchResult[] = [];

  public async search(query: string): Promise<string> {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Tier 1: DuckDuckGo HTML scrape — much richer than the JSON Instant Answer API
    try {
      const encoded = encodeURIComponent(query);
      const res = await axios.get(
        `https://html.duckduckgo.com/html/?q=${encoded}`,
        {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 10000,
          responseType: 'text',
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

      const count = Math.min(titles.length, snippets.length, 7);
      for (let i = 0; i < count; i++) {
        results.push(`- ${titles[i]}: ${snippets[i].slice(0, 200)}`);
        this.lastResults.push({
          title: titles[i],
          url: urls[i] ?? null,
          snippet: snippets[i],
        });
      }
      // If only titles available (no snippets parsed), use titles alone
      if (results.length === 0 && titles.length >= 3) {
        for (const t of titles.slice(0, 7)) {
          results.push(`- ${t}`);
          this.lastResults.push({ title: t, url: null, snippet: '' });
        }
      }

      if (results.length >= 2) {
        return `Web search results for "${query}":\n${results.join('\n')}`;
      }
    } catch { /* cascade */ }

    // Tier 2: DuckDuckGo Instant Answer JSON (good for entity lookups)
    try {
      const encoded = encodeURIComponent(query);
      const res = await axios.get(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': UA }, timeout: 8000 },
      );
      const data = res.data;
      const results: string[] = [];
      if (data.AbstractText?.trim()) results.push(`- ${data.AbstractText.trim().slice(0, 300)}`);
      if (data.Answer?.trim()) results.push(`- ${data.Answer.trim().slice(0, 200)}`);
      for (const topic of (data.RelatedTopics ?? []).slice(0, 8)) {
        const text = topic.Text ?? topic.Result;
        if (text?.trim()) results.push(`- ${String(text).trim().slice(0, 200)}`);
        for (const sub of (topic.Topics ?? []).slice(0, 2)) {
          if (sub.Text?.trim()) results.push(`- ${String(sub.Text).trim().slice(0, 200)}`);
        }
      }
      if (results.length >= 2) {
        return `Web search results for "${query}":\n${results.slice(0, 8).join('\n')}`;
      }
    } catch { /* cascade */ }

    // Tier 3: Yahoo Finance news search (best for financial / ticker queries)
    try {
      const searchRes = await yahooFinance.search(query, { newsCount: 12, quotesCount: 0 });
      const headlines = (searchRes.news ?? [])
        .slice(0, 10)
        .map((n: any) => `- ${n.title ?? ''}${n.publisher ? ' (' + n.publisher + ')' : ''}`)
        .filter(Boolean);
      if (headlines.length >= 2) {
        return `Web search results for "${query}":\n${headlines.join('\n')}`;
      }
    } catch { /* cascade */ }

    // Tier 4: Direct Indonesian RSS scrape for IHSG-related queries
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
    // First, get the live search results so we have candidate URLs.
    const baseResults = await this.search(query);

    // If we have URLs from the DDG tier, fetch and RAG the top pages.
    const candidates = this.lastResults.filter(r => r.url);
    if (candidates.length === 0) {
      return baseResults;
    }

    const fetchCount = Math.min(depth, candidates.length, 3);
    const perPage = depth >= 3 ? 4 : depth === 2 ? 3 : 2;
    const topK = Math.min(perPage, 3);

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
      `Deep web research for "${query}" (${sections.length} source${sections.length === 1 ? '' : 's'} analyzed):`,
      '',
      ...sections,
    ].join('\n\n');
  }
}

export const webSearchService = new WebSearchService();
