import { CheerioAPI } from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import { fetchCheerio, normalizeWhitespace } from "../EngineUtils.js";

const BRAVE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export default class Brave implements ISearchEngine {
  private readonly baseUrl = "https://search.brave.com";

  async search(query: string, region?: string): Promise<SearchResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("source", "web");

    if (region) {
      const segments = region.split('-');
      const country = segments.pop();
      const language = segments.shift();

      if (country) {
        url.searchParams.set("country", country.toLowerCase());
      }

      if (language) {
        url.searchParams.set("lang", language.toLowerCase());
      }
    }

    const page = await fetchCheerio(url.toString(), {}, BRAVE_HEADERS);
    return this.extractResults(page.$);
  }

  private extractResults($: CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $('div#results div.snippet:not(.standalone)').each((_, element) => {
      const item = $(element);
      const anchor = item.find('a[href]').first();
      const href = anchor.attr('href');

      if (!href || seen.has(href)) {
        return;
      }

      const title = normalizeWhitespace(
          item.find('div.title').text() || anchor.text(),
      );

      if (!title) {
        return;
      }

      const snippet = normalizeWhitespace(
        item.find('div.snippet-description').text(),
      );

      results.push(new SearchResult(title, href, snippet));
      seen.add(href);
    });

    return results;
  }
}
