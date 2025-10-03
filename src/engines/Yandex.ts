import { CheerioAPI } from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import { fetchCheerio, normalizeWhitespace } from "../EngineUtils.js";

const YANDEX_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

export default class Yandex implements ISearchEngine {
  private readonly baseUrl = "https://yandex.com";

  async search(query: string, region?: string): Promise<SearchResult[]> {
    const url = new URL("/search/", this.baseUrl);
    url.searchParams.set("text", query);
    url.searchParams.set("lr", "84"); // Default to English results

    if (region) {
      const locale = this.toYandexLocale(region);
      if (locale) {
        url.searchParams.set("lang", locale.lang);
      }
    }

    try {
      const page = await fetchCheerio(url.toString(), {}, YANDEX_HEADERS);
      return this.extractResults(page.$);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Yandex search failed: ${message}`);
    }
  }

  private extractResults($: CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    // Yandex search results
    $("li.serp-item").each((_, element) => {
      const item = $(element);

      // Extract URL from the main link
      const anchor = item.find("a.Link").first();
      const href = anchor.attr("href");

      if (!href || !href.startsWith("http")) {
        return;
      }

      if (seen.has(href)) {
        return;
      }

      // Extract title
      const titleElement = item.find("h2, h3").first();
      const title = normalizeWhitespace(titleElement.text());

      if (!title) {
        return;
      }

      // Extract snippet
      const snippetElement = item.find("div.text-container, div.OrganicText").first();
      const snippet = normalizeWhitespace(snippetElement.text());

      results.push(new SearchResult(title, href, snippet));
      seen.add(href);
    });

    return results;
  }

  private toYandexLocale(region: string): { lang: string } | undefined {
    const normalized = region.toLowerCase().replace("_", "-");
    const parts = normalized.split("-");

    if (parts.length === 2) {
      return { lang: `${parts[0]}_${parts[1].toUpperCase()}` };
    }

    return { lang: "en_US" };
  }
}
