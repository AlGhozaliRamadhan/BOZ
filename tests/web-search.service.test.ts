import { describe, expect, it } from 'vitest';
import {
  buildGoogleNewsRssUrl,
  formatWebSearchResults,
  type WebSearchResult,
} from '../src/services/search/web.search.service.js';

describe('live web search formatting', () => {
  it('uses an encoded Google News RSS query endpoint', () => {
    expect(buildGoogleNewsRssUrl('NVDA news & earnings')).toBe(
      'https://news.google.com/rss/search?q=NVDA%20news%20%26%20earnings&hl=en-US&gl=US&ceid=US:en',
    );
  });

  it('retains source URLs and summaries while limiting output to twelve results', () => {
    const results: WebSearchResult[] = Array.from({ length: 14 }, (_, index) => ({
      title: `Source ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      snippet: `Summary ${index + 1}`,
    }));
    results[0].publisher = 'Example Publisher';
    results[0].publisherUrl = 'https://publisher.example.com';

    const output = formatWebSearchResults('NVDA news', results);

    expect(output).toContain('- [Source 1](https://example.com/1)');
    expect(output).toContain('URL: https://example.com/1');
    expect(output).toContain('Publisher: Example Publisher');
    expect(output).toContain('Publisher URL: https://publisher.example.com');
    expect(output).toContain('Summary: Summary 1');
    expect(output).toContain('Source 12');
    expect(output).not.toContain('Source 13');
  });
});
