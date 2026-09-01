import DOMPurify from 'isomorphic-dompurify';
import { fetchPublicText } from '../security/public-http-client.js';

export class WebsiteRagService {
  /**
   * Fetches a website, cleans the HTML, chunks the text, and returns the most relevant
   * chunks based on a simple keyword-matching RAG (Retrieval-Augmented Generation) approach.
   */
  public async readAndExtract(url: string, query: string, topK: number = 3): Promise<string> {
    try {
      // 1. Fetch website
      const res = await fetchPublicText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeoutMs: 10000,
      });

      const html = res.text;
      if (!html || typeof html !== 'string') {
        return `Failed to read ${url}: Invalid HTML response.`;
      }

      // 2. Clean HTML
      // Use DOMPurify to sanitize untrusted HTML instead of regex-based tag filtering.
      // ALLOWED_TAGS: [] strips all tags; FORBID_TAGS ensures script/style are removed.
      let cleaned = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [],
        FORBID_TAGS: ['script', 'style'],
      });
      
      // Normalize whitespace
      cleaned = cleaned.replace(/\s+/g, ' ').trim();

      if (!cleaned) {
        return `No readable text found on ${url}.`;
      }

      // 3. Chunk the text
      const chunkSize = 1500;
      const chunks: string[] = [];
      for (let i = 0; i < cleaned.length; i += chunkSize) {
        chunks.push(cleaned.slice(i, i + chunkSize));
      }

      // 4. Rank chunks (Simple Keyword RAG)
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      const scoredChunks = chunks.map(chunk => {
        const lowerChunk = chunk.toLowerCase();
        let score = 0;
        for (const word of queryWords) {
          if (lowerChunk.includes(word)) score += 1;
        }
        return { chunk, score };
      });

      scoredChunks.sort((a, b) => b.score - a.score);

      // 5. Format results
      const topChunks = scoredChunks.slice(0, topK).filter(c => c.score > 0 || chunks.length <= topK);
      
      if (topChunks.length === 0) {
        // Fallback to just the first chunks if no keyword overlap
        const fallback = chunks.slice(0, topK).map((c, i) => `[Chunk ${i + 1}]: ${c}`).join('\n\n');
        return `Extracted text from ${url} (No direct match for "${query}"):\n\n${fallback}`;
      }

      const results = topChunks.map((c, i) => `[Relevant Chunk ${i + 1} (Score: ${c.score})]: ${c.chunk}`).join('\n\n');
      return `RAG Extracted text from ${url} for query "${query}":\n\n${results}`;
    } catch (err: any) {
      return `Error reading website ${url}: ${err.message}`;
    }
  }
}

export const websiteRagService = new WebsiteRagService();
