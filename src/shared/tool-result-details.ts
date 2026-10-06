export interface WebSourceDetail {
  title: string;
  url?: string;
  summary?: string;
  publisher?: string;
  publisherUrl?: string;
}

function safeHttpUrl(candidate: string): string | undefined {
  try {
    const parsed = new URL(candidate.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function parseMarkdownLink(value: string): { title: string; url?: string } {
  const match = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (!match) return { title: value.trim() };
  return { title: match[1].trim(), url: safeHttpUrl(match[2]) };
}

/**
 * Turns the text returned by the web tool into safe, display-ready source
 * entries. It supports both the search listing and deep-research sections.
 */
export function parseWebSources(detail: string | undefined): WebSourceDetail[] {
  if (!detail?.trim()) return [];

  const sources: WebSourceDetail[] = [];
  let current: WebSourceDetail | undefined;

  const startSource = (rawTitle: string) => {
    const parsed = parseMarkdownLink(rawTitle.trim());
    if (!parsed.title) return;
    current = { title: parsed.title, url: parsed.url };
    sources.push(current);
  };

  for (const line of detail.split(/\r?\n/)) {
    const listed = line.match(/^\s*-\s+(.+)$/);
    if (listed) {
      startSource(listed[1]);
      continue;
    }

    const section = line.match(/^##\s+(.+)$/);
    if (section) {
      startSource(section[1]);
      continue;
    }

    if (!current) continue;

    const url = line.match(/^\s*(?:URL|Source):\s*(\S+)\s*$/i);
    if (url) {
      current.url = safeHttpUrl(url[1]) ?? current.url;
      continue;
    }

    const publisher = line.match(/^\s*Publisher:\s*(.+)$/i);
    if (publisher) {
      current.publisher = publisher[1].trim();
      continue;
    }

    const publisherUrl = line.match(/^\s*Publisher URL:\s*(\S+)\s*$/i);
    if (publisherUrl) {
      current.publisherUrl = safeHttpUrl(publisherUrl[1]) ?? current.publisherUrl;
      continue;
    }

    const summary = line.match(/^\s*(?:Summary|Snippet):\s*(.+)$/i);
    if (summary) current.summary = summary[1].trim();
  }

  const unique = new Map<string, WebSourceDetail>();
  for (const source of sources) {
    const key = source.url ?? source.title.toLowerCase();
    const previous = unique.get(key);
    unique.set(key, {
      title: previous?.title ?? source.title,
      url: source.url ?? previous?.url,
      summary: source.summary ?? previous?.summary,
      publisher: source.publisher ?? previous?.publisher,
      publisherUrl: source.publisherUrl ?? previous?.publisherUrl,
    });
  }
  return [...unique.values()];
}

export function describeToolCall(tool: string, args?: Record<string, unknown>): string {
  const name = tool.replace(/_/g, ' ');
  const symbol = args?.symbol ?? args?.symbol_or_name;
  return symbol ? `${name} (${String(symbol).toUpperCase()})` : name;
}
