import { describe, expect, it } from 'vitest';
import { describeToolCall, parseWebSources } from '../src/app/chat/tool-result-details.js';

describe('tool result detail helpers', () => {
  it('extracts linked search candidates and their summaries', () => {
    const sources = parseWebSources(`Web search results for "NVDA earnings":
- [NVIDIA earnings release](https://investor.nvidia.com/results)
  URL: https://investor.nvidia.com/results
  Publisher: NVIDIA Newsroom
  Publisher URL: https://nvidianews.nvidia.com
  Summary: Data center revenue increased year over year.
- Market coverage
  URL: https://example.com/nvda
  Summary: Analysts focus on guidance.`);

    expect(sources).toEqual([
      {
        title: 'NVIDIA earnings release',
        url: 'https://investor.nvidia.com/results',
        publisher: 'NVIDIA Newsroom',
        publisherUrl: 'https://nvidianews.nvidia.com/',
        summary: 'Data center revenue increased year over year.',
      },
      {
        title: 'Market coverage',
        url: 'https://example.com/nvda',
        summary: 'Analysts focus on guidance.',
      },
    ]);
  });

  it('keeps only safe source URLs and labels ticker tool calls', () => {
    const sources = parseWebSources(`- Unsafe result
  URL: javascript:alert(1)
  Summary: Ignore this link.`);

    expect(sources).toEqual([{ title: 'Unsafe result', summary: 'Ignore this link.' }]);
    expect(describeToolCall('fetch_ticker_dashboard', { symbol: 'nvda' }))
      .toBe('fetch ticker dashboard (NVDA)');
  });
});
