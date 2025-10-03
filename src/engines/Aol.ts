import { CheerioAPI } from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import { decodeYahooRedirectUrl, fetchCheerio, normalizeWhitespace } from "../EngineUtils.js";

const AOL_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

export default class Aol implements ISearchEngine {
  private readonly baseUrl = "https://search.aol.com";

  async search(query: string, region?: string): Promise<SearchResult[]> {
    const url = new URL("/aol/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("nojs", "1");
    url.searchParams.set("ei", "UTF-8");

    const headers: Record<string, string> = { ...AOL_HEADERS };

    if (region) {
      const normalized = region.trim();
      if (normalized) {
        headers["Accept-Language"] = normalized.replace("_", "-");
      }
    }

    const page = await fetchCheerio(url.toString(), {}, headers);
    return this.extractResults(page.$);
  }

  private extractResults($: CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("#web ol.reg > li").each((_, element) => {
      const item = $(element);
      const anchor = item.find("div.compTitle h3.title a").first();

      if (!anchor.length) {
        return;
      }

      const rawHref = anchor.attr("href");
      if (!rawHref) {
        return;
      }

      const decodedHref = decodeYahooRedirectUrl(rawHref);
      const href = decodedHref.startsWith("//") ? `https:${decodedHref}` : decodedHref;
      if (!/^https?:\/\//i.test(href)) {
        return;
      }

      if (seen.has(href)) {
        return;
      }

      const title = normalizeWhitespace(anchor.text());
      if (!title) {
        return;
      }

      const snippetSource = item
        .find("div.compText p, p")
        .map((__, el) => $(el).text())
        .get()
        .join(" ");
      const snippet = normalizeWhitespace(snippetSource);

      results.push(new SearchResult(title, href, snippet));
      seen.add(href);
    });

    return results;
  }
}
