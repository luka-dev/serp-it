import {CheerioAPI} from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import {decodeYahooRedirectUrl, fetchCheerio, normalizeWhitespace,} from "../EngineUtils.js";

const YAHOO_HEADERS: Record<string, string> = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",};
export default class Yahoo implements ISearchEngine {
    private readonly baseUrl = "https://search.yahoo.com";

    async search(query: string, region?: string): Promise<SearchResult[]> {
        const url = new URL("/search", this.baseUrl);
        url.searchParams.set("p", query);
        url.searchParams.set("ei", "UTF-8");
        url.searchParams.set("nojs", "1");
        if (region) {
            const segments = region.split('-');
            const language = segments.shift();
            const country = segments.pop();
            if (language) {
                url.searchParams.set("vl", language.toLowerCase());
            }
            if (country) {
                url.searchParams.set("vc", country.toUpperCase());
            }
        }
        const page = await fetchCheerio(url.toString(), {}, YAHOO_HEADERS);
        return this.extractResults(page.$);
    }

    private extractResults($: CheerioAPI): SearchResult[] {
        const results: SearchResult[] = [];
        const seen = new Set<string>();
        $('div#web li div.dd.algo.algo-sr').each((_, element) => {
            const item = $(element);
            const anchor = item.find('a').first();
            const href = anchor.attr('href');
            if (!href) {
                return;
            }
            const url = decodeYahooRedirectUrl(href);
            if (seen.has(url)) {
                return;
            }
            const titleNode = item.find('h3.title').first();
            const title = normalizeWhitespace(titleNode.text());
            if (!title) {
                return;
            }
            const snippet = normalizeWhitespace(item.find('div.compText').text());
            results.push(new SearchResult(title, url, snippet));
            seen.add(url);
        });
        return results;
    }
}
