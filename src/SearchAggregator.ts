import Aol from './engines/Aol.js';
import Bing from './engines/Bing.js';
import Brave from './engines/Brave.js';
import DuckDuckGo from './engines/DuckDuckGo.js';
import Yahoo from './engines/Yahoo.js';
import Startpage from './engines/Startpage.js';
import Yandex from './engines/Yandex.js';
import type ISearchEngine from './ISearchEngine.js';
import SearchResult from './SearchResult.js';

export interface AggregatedResult {
  title: string;
  url: string;
  snippet: string;
  sources: string[];
}

export interface AggregatedSearch {
  results: AggregatedResult[];
  engineErrors: string[];
}

type EngineEntry = {
  name: string;
  engine: ISearchEngine;
};

const engines: EngineEntry[] = [
  { name: 'AOL', engine: new Aol() },
  { name: 'Brave', engine: new Brave() },
  { name: 'Bing', engine: new Bing() },
  { name: 'DuckDuckGo', engine: new DuckDuckGo() },
  { name: 'Yahoo', engine: new Yahoo() },
  { name: 'Startpage', engine: new Startpage() },
  { name: 'Yandex', engine: new Yandex() },
];

function sanitizeUrl(rawUrl: string): { key: string; href: string } | undefined {
  if (!rawUrl) {
    return undefined;
  }

  let trimmed = rawUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';

    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    const normalizedHref = parsed.toString();
    return {
      key: normalizedHref.toLowerCase(),
      href: normalizedHref,
    };
  } catch (error) {
    return undefined;
  }
}

function mergeResult(
  accumulator: Map<string, AggregatedResult>,
  incoming: SearchResult,
  source: string,
): void {
  const sanitized = sanitizeUrl(incoming.url);
  if (!sanitized) {
    return;
  }

  const existing = accumulator.get(sanitized.key);
  const snippet = incoming.snippet ?? '';
  const title = incoming.title ?? sanitized.href;

  if (existing) {
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }

    if (!existing.snippet && snippet) {
      existing.snippet = snippet;
    }

    if (!existing.title && title) {
      existing.title = title;
    }

    return;
  }

  accumulator.set(sanitized.key, {
    title,
    url: sanitized.href,
    snippet,
    sources: [source],
  });
}

export async function searchAllEngines(
  query: string,
  region?: string,
): Promise<AggregatedSearch> {
  const aggregated = new Map<string, AggregatedResult>();
  const engineErrors: string[] = [];

  for (const { name, engine } of engines) {
    try {
      const results = await engine.search(query, region);
      for (const result of results) {
        mergeResult(aggregated, result, name);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineErrors.push(`${name}: ${message}`);
    }
  }

  return {
    results: Array.from(aggregated.values()),
    engineErrors,
  };
}
