import { CheerioAPI } from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import { fetchCheerio, normalizeWhitespace } from "../EngineUtils.js";

const STARTPAGE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1"
};

export default class Startpage implements ISearchEngine {
  private readonly baseUrl = "https://www.startpage.com";

  async search(query: string, region?: string): Promise<SearchResult[]> {
    const url = new URL("/sp/search", this.baseUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("cat", "web");
    url.searchParams.set("pl", "ext-ff");
    url.searchParams.set("extVersion", "1.3.0");

    if (region) {
      const locale = this.toStartpageLocale(region);
      if (locale) {
        url.searchParams.set("language", locale.language);
        url.searchParams.set("lui", locale.language);
      }
    } else {
      url.searchParams.set("language", "english");
      url.searchParams.set("lui", "english");
    }

    try {
      const page = await fetchCheerio(url.toString(), {}, STARTPAGE_HEADERS);
      return this.extractResults(page.$);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Startpage search failed: ${message}`);
    }
  }

  private extractResults($: CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    // Startpage uses different selectors
    $("div.w-gl__result").each((_, element) => {
      const item = $(element);

      // Extract URL
      const anchor = item.find("a.w-gl__result-title").first();
      const href = anchor.attr("href");

      if (!href || !href.startsWith("http")) {
        return;
      }

      if (seen.has(href)) {
        return;
      }

      // Extract title
      const title = normalizeWhitespace(anchor.text());
      if (!title) {
        return;
      }

      // Extract snippet
      const snippetElement = item.find("p.w-gl__description").first();
      const snippet = normalizeWhitespace(snippetElement.text());

      results.push(new SearchResult(title, href, snippet));
      seen.add(href);
    });

    return results;
  }

  private toStartpageLocale(region: string): { language: string } | undefined {
    const normalized = region.toLowerCase().split("-")[0];

    const languageMap: Record<string, string> = {
      "en": "english",
      "de": "deutsch",
      "fr": "francais",
      "es": "espanol",
      "it": "italiano",
      "nl": "nederlands",
      "pt": "portugues",
      "pl": "polski",
      "ru": "russian",
      "zh": "chinese",
      "ja": "japanese",
      "ko": "korean"
    };

    const language = languageMap[normalized];
    if (language) {
      return { language };
    }

    return undefined;
  }
}
