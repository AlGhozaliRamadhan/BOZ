import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TechnicalStrip from '../src/app/components/ui/TechnicalStrip';

describe('ticker dashboard technical strip', () => {
  it('starts with a concise overview while keeping the full indicator view available', () => {
    const html = renderToStaticMarkup(createElement(TechnicalStrip, { ticker: 'AAPL' }));

    expect(html).toContain('6 INDICATORS');
    expect(html).toContain('>OVERVIEW<');
    expect(html).toContain('>ALL<');
    expect(html).toContain('RSI (14)');
    expect(html).not.toContain('BB WIDTH');
  });
});
