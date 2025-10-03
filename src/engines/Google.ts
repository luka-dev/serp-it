import { CheerioAPI } from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import { fetchCheerio, normalizeWhitespace } from "../EngineUtils.js";

const GOOGLE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1"
};

export default class Google implements ISearchEngine {
  private readonly baseUrl = "https://www.google.com";

  async search(query: string, region?: string): Promise<SearchResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("num", "20");

    if (region) {
      const locale = this.toGoogleLocale(region);
      if (locale) {
        url.searchParams.set("hl", locale.language);
        url.searchParams.set("gl", locale.country);
      }
    }

    const page = await fetchCheerio(url.toString(), {}, GOOGLE_HEADERS);
    return this.extractResults(page.$);
  }

  private extractResults($: CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    // Main search results container
    $("div.g, div[data-sokoban-container]").each((_, element) => {
      const item = $(element);

      // Try multiple selectors for title and link
      const anchor = item.find("a[href]").first();
      const href = anchor.attr("href");

      if (!href || !href.startsWith("http")) {
        return;
      }

      // Extract title from h3 or anchor text
      const titleElement = item.find("h3").first();
      const title = normalizeWhitespace(
        titleElement.length ? titleElement.text() : anchor.text()
      );

      if (!title || seen.has(href)) {
        return;
      }

      // Extract snippet from various possible containers
      const snippetElement =
        item.find("div[data-sncf='1'], div.VwiC3b, span.aCOpRe, div.s").first();
      const snippet = normalizeWhitespace(snippetElement.text());

      results.push(new SearchResult(title, href, snippet));
      seen.add(href);
    });

    return results;
  }

  private toGoogleLocale(region: string): { language: string; country: string } | undefined {
    const normalized = region.replace("_", "-");
    const parts = normalized.split("-");

    if (parts.length !== 2) {
      return undefined;
    }

    return {
      language: parts[0].toLowerCase(),
      country: parts[1].toUpperCase()
    };
  }
}
