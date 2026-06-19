import { NextResponse, NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') || '';
    const fetchUrl = `https://github.com/marketplace?type=models${query ? `&query=${encodeURIComponent(query)}` : ''}`;

    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }
    });
    
    if (!res.ok) {
      return NextResponse.json({ models: [] });
    }

    const html = await res.text();
    const prefix = '<script type="application/json" data-target="react-app.embeddedData">';
    const startIdx = html.indexOf(prefix);
    
    if (startIdx === -1) {
      return NextResponse.json({ models: [] });
    }

    const endIdx = html.indexOf('</script>', startIdx);
    if (endIdx === -1) {
      return NextResponse.json({ models: [] });
    }

    const jsonString = html.slice(startIdx + prefix.length, endIdx);
    const json = JSON.parse(jsonString);

    const unique = new Map();

    function extractModels(obj: any) {
      if (!obj) return;
      if (typeof obj === 'object') {
        if ((obj.publisherDisplayName || obj.publisher) && obj.name) {
          const publisherSlug = obj.publisherSlug || obj.publisher;
          const id = `${publisherSlug.toLowerCase()}/${obj.name}`;
          const label = `${obj.friendly_name || obj.name} (${obj.publisherDisplayName || obj.publisher})`;
          unique.set(id, { id, label });
        }
        Object.values(obj).forEach(extractModels);
      }
    }

    if (query && json.payload.searchResults) {
      extractModels(json.payload.searchResults);
    } else {
      extractModels(json.payload);
    }

    return NextResponse.json({ models: Array.from(unique.values()) });
  } catch (err) {
    console.error('Failed to fetch github marketplace models:', err);
    return NextResponse.json({ models: [] });
  }
}
