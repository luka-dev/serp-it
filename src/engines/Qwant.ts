import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";

const QWANT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.qwant.com/"
};

interface QwantResult {
  title?: string;
  url?: string;
  desc?: string;
}

interface QwantResponse {
  data?: {
    result?: {
      items?: Array<{
        items?: QwantResult[];
      }>;
    };
  };
}

export default class Qwant implements ISearchEngine {
  private readonly baseUrl = "https://api.qwant.com/v3/search/web";

  async search(query: string, region?: string): Promise<SearchResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("count", "20");
    url.searchParams.set("offset", "0");

    if (region) {
      const locale = this.toQwantLocale(region);
      if (locale) {
        url.searchParams.set("locale", locale);
      }
    } else {
      url.searchParams.set("locale", "en_US");
    }

    try {
      const response = await fetch(url.toString(), {
        headers: QWANT_HEADERS,
      });

      if (!response.ok) {
        throw new Error(`Qwant API returned ${response.status}`);
      }

      const data: QwantResponse = await response.json();
      return this.extractResults(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Qwant search failed: ${message}`);
    }
  }

  private extractResults(data: QwantResponse): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    const items = data?.data?.result?.items;
    if (!items || !Array.isArray(items)) {
      return results;
    }

    for (const section of items) {
      if (!section.items || !Array.isArray(section.items)) {
        continue;
      }

      for (const item of section.items) {
        const url = item.url?.trim();
        const title = item.title?.trim();

        if (!url || !title || seen.has(url)) {
          continue;
        }

        const snippet = item.desc?.trim() || "";
        results.push(new SearchResult(title, url, snippet));
        seen.add(url);
      }
    }

    return results;
  }

  private toQwantLocale(region: string): string {
    const normalized = region.replace("-", "_");
    return normalized;
  }
}
