import axios from 'axios';
import { yahooFinance } from '../market/yahoo.service.js';
import { newsFetchService } from '../news/news.fetch.service.js';

export class WebSearchService {
  /**
   * Performs a multi-tiered web search.
   * Tier 1: DuckDuckGo HTML scrape
   * Tier 2: DuckDuckGo Instant Answer JSON
   * Tier 3: Yahoo Finance news search
   * Tier 4: Direct Indonesian RSS scrape for IHSG-related queries
   */
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

      // Extract result snippets — DDG HTML uses class="result__snippet"
      const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const titleRe   = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
      const titles:   string[] = [];
      const snippets: string[] = [];

      let m: RegExpExecArray | null;
      while ((m = titleRe.exec(html)) !== null) {
        const t = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim();
        if (t) titles.push(t);
      }
      while ((m = snippetRe.exec(html)) !== null) {
        const s = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim();
        if (s) snippets.push(s);
      }

      const count = Math.min(titles.length, snippets.length, 7);
      for (let i = 0; i < count; i++) {
        results.push(`- ${titles[i]}: ${snippets[i].slice(0, 200)}`);
      }
      // If only titles available (no snippets parsed), use titles alone
      if (results.length === 0 && titles.length >= 3) {
        for (const t of titles.slice(0, 7)) results.push(`- ${t}`);
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
}

export const webSearchService = new WebSearchService();
