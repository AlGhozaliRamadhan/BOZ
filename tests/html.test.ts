import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from '../src/utils/html.js';

describe('htmlToPlainText', () => {
  it('removes markup and dangerous element contents', () => {
    expect(htmlToPlainText('<script>alert(1)</script><b>Market</b> data')).toBe('Market data');
  });

  it('decodes supported entities once', () => {
    expect(htmlToPlainText('Tom &#x27;Ace&#x27; &amp; Co.')).toBe("Tom 'Ace' & Co.");
  });

  it('does not recursively decode nested markup', () => {
    expect(htmlToPlainText('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
