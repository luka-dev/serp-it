import {CheerioAPI} from "cheerio";
import ISearchEngine from "../ISearchEngine.js";
import SearchResult from "../SearchResult.js";
import {buildCookieHeader, decodeBingRedirectUrl, fetchCheerio, normalizeWhitespace,} from "../EngineUtils.js";

const BING_HEADERS: Record<string, string> = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",};
export default class Bing implements ISearchEngine {
    private readonly baseUrl = "https://www.bing.com";

    async search(query: string, region?: string): Promise<SearchResult[]> {
        const entryPage = await fetchCheerio(this.baseUrl, {}, BING_HEADERS);
        const entryCookies = entryPage.response.headers.getSetCookie?.() ?? [];
        const url = new URL("/search", this.baseUrl);
        url.searchParams.set("q", query);
        url.searchParams.set("search", "");
        url.searchParams.set("form", "QBLH");
        if (region) {
            url.searchParams.set("cc", region.toUpperCase());
        }
        const cookieHeader = buildCookieHeader(entryCookies);
        const headers: Record<string, string> = {...BING_HEADERS};
        if (cookieHeader) {
            headers.Cookie = cookieHeader;
        }
        const page = await fetchCheerio(url.toString(), {}, headers);
        return this.extractResults(page.$);
    }

    private extractResults($: CheerioAPI): SearchResult[] {
        const results: SearchResult[] = [];
        const seen = new Set<string>();
        $('ol#b_results > li.b_algo').each((_, element) => {
            const item = $(element);
            const anchor = item.find('h2 a').first();
            const href = anchor.attr('href');
            if (!href) {
                return;
            }
            const url = decodeBingRedirectUrl(href);
            if (seen.has(url)) {
                return;
            }
            const title = normalizeWhitespace(anchor.text());
            if (!title) {
                return;
            }
            const caption = item.find('div.b_caption');
            const paragraphs = caption.find('p');
            const snippetSource = paragraphs.length ? paragraphs.map((_, el) => $(el).text()).get().join(' ') : caption.text();
            const snippet = normalizeWhitespace(snippetSource || item.find('p').map((_, el) => $(el).text()).get().join(' '),);
            results.push(new SearchResult(title, url, snippet));
            seen.add(url);
        });
        return results;
    }
}
