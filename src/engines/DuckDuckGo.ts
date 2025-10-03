import type {Cheerio} from 'cheerio';
import type {Element} from 'domhandler';
import {CheerioAPI} from 'cheerio';

import ISearchEngine from '../ISearchEngine.js';
import SearchResult from '../SearchResult.js';
import {buildCookieHeader, fetchCheerio, normalizeWhitespace} from '../EngineUtils.js';

const BASE_HEADERS: Record<string, string> = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    Origin: 'https://duckduckgo.com',
    Referer: 'https://duckduckgo.com/',
};

const HTML_ENDPOINT = 'https://html.duckduckgo.com/html';
const HOME_ENDPOINT = 'https://duckduckgo.com/';

interface DuckDuckGoSession {
    market: string;
    vqd?: string;
    cookies: string[];
    cookieHeader?: string;
}

export default class DuckDuckGo implements ISearchEngine {
    private readonly maxPages = 4;
    private readonly maxAttempts = 3;

    async search(query: string, region?: string): Promise<SearchResult[]> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
            try {
                return await this.performSearch(query, region);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt < this.maxAttempts - 1) {
                    await this.delay((attempt + 1) * 250);
                }
            }
        }

        throw lastError ?? new Error('DuckDuckGo search failed');
    }

    private async performSearch(query: string, region?: string): Promise<SearchResult[]> {
        const session = await this.initializeSession(query, region);
        if (!session.vqd) {
            throw new Error('DuckDuckGo HTML missing vqd token');
        }

        const collected: SearchResult[] = [];
        const seen = new Set<string>();

        let params: URLSearchParams | undefined = this.createInitialParams(
            query,
            session.market,
            session.vqd,
        );

        for (let pageIndex = 0; pageIndex < this.maxPages && params; pageIndex += 1) {
            const page = await this.fetchDuckDuckGoPage(HTML_ENDPOINT, params, session);

            if (this.isChallengePage(page.response.status, page.html)) {
                throw new Error('DuckDuckGo HTML endpoint responded with a challenge');
            }

            const unique = this.extractHtmlResults(page.$, seen);
            collected.push(...unique);

            params = this.extractNextParamsFromHtml(page.$, params, session);
        }

        return collected;
    }

    private async initializeSession(query: string, region?: string): Promise<DuckDuckGoSession> {
        const market = this.toDuckDuckGoLocale(region) ?? 'wt-wt';
        const url = new URL(HOME_ENDPOINT);
        url.searchParams.set('q', query);
        url.searchParams.set('ia', 'web');
        url.searchParams.set('kl', market);

        const headers: Record<string, string> = {
            ...BASE_HEADERS,
        };

        const page = await fetchCheerio(url.toString(), {}, headers);
        const setCookies = page.response.headers.getSetCookie?.() ?? [];
        const cookieHeader = buildCookieHeader(setCookies);

        const vqdMatch =
            page.html.match(/vqd='([^']+)'/) ||
            page.html.match(/vqd="([^"]+)"/) ||
            page.html.match(/vqd=\"([^\"]+)\"/);

        return {
            market,
            vqd: vqdMatch ? vqdMatch[1] : undefined,
            cookies: setCookies,
            cookieHeader,
        };
    }

    private async fetchDuckDuckGoPage(
        endpoint: string,
        params: URLSearchParams,
        session: DuckDuckGoSession,
    ) {
        const headers: Record<string, string> = {
            ...BASE_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
        };

        if (session.cookieHeader) {
            headers.Cookie = session.cookieHeader;
        }

        const page = await fetchCheerio(
            endpoint,
            {
                method: 'POST',
                body: params.toString(),
                redirect: 'follow',
            },
            headers,
        );

        const setCookies = page.response.headers.getSetCookie?.() ?? [];
        if (setCookies.length) {
            session.cookies = [...session.cookies, ...setCookies];
            session.cookieHeader = buildCookieHeader(session.cookies);
        }

        return page;
    }

    private createInitialParams(query: string, market: string, vqd: string): URLSearchParams {
        return new URLSearchParams({
            q: query,
            s: '0',
            o: 'json',
            api: 'd.js',
            vqd,
            kl: market,
            bing_market: market,
        });
    }

    private extractNextParamsFromHtml(
        $: CheerioAPI,
        current: URLSearchParams,
        session: DuckDuckGoSession,
    ): URLSearchParams | undefined {
        const navForm = $('div.nav-link form').last();
        if (!navForm.length) {
            return undefined;
        }

        return this.buildParamsFromForm($, navForm, current, session);
    }

    private buildParamsFromForm(
        $: CheerioAPI,
        form: Cheerio<Element>,
        current: URLSearchParams,
        session: DuckDuckGoSession,
    ): URLSearchParams | undefined {
        const inputs = form.find('input[name]');
        if (!inputs.length) {
            return undefined;
        }

        const params = new URLSearchParams();
        inputs.each((_, element) => {
            const name = $(element).attr('name');
            if (!name) {
                return;
            }

            const value = $(element).attr('value') ?? '';
            if (value) {
                params.set(name, value);
            }
        });

        if (!params.has('q')) {
            params.set('q', current.get('q') ?? '');
        }

        if (!params.has('o')) {
            params.set('o', 'json');
        }

        if (!params.has('api')) {
            params.set('api', 'd.js');
        }

        if (session.vqd && !params.has('vqd')) {
            params.set('vqd', session.vqd);
        }

        if (!params.has('kl')) {
            params.set('kl', session.market);
        }

        if (!params.has('bing_market')) {
            params.set('bing_market', session.market);
        }

        const signature = params.toString();
        if (!signature || signature === current.toString()) {
            return undefined;
        }

        return params;
    }

    private extractHtmlResults($: CheerioAPI, seen: Set<string>): SearchResult[] {
        const results: SearchResult[] = [];

        $('div.result.results_links.results_links_deep.web-result').each((_, element) => {
            const item = $(element);
            const anchor = item.find('h2.result__title a.result__a').first();
            const href = anchor.attr('href')?.trim();

            if (!href) {
                return;
            }

            const url = this.resolveUrl(href);
            if (!url || seen.has(url) || url.includes('duckduckgo.com/y.js')) {
                return;
            }

            const title = normalizeWhitespace(anchor.text());
            if (!title) {
                return;
            }

            const snippet = normalizeWhitespace(
                item.find('.result__snippet').first().text(),
            );

            results.push(new SearchResult(title, url, snippet));
            seen.add(url);
        });

        return results;
    }

    private resolveUrl(rawHref: string): string | undefined {
        let href = rawHref;

        if (href.startsWith('/')) {
            href = new URL(href, HTML_ENDPOINT).toString();
        }

        if (href.startsWith('https://duckduckgo.com/l/?')) {
            try {
                const redirect = new URL(href);
                const encoded = redirect.searchParams.get('uddg');
                if (!encoded) {
                    return undefined;
                }

                href = decodeURIComponent(encoded);
            } catch (error) {
                return undefined;
            }
        }

        if (!/^https?:\/\//i.test(href)) {
            return undefined;
        }

        return href;
    }

    private isChallengePage(status: number, html: string): boolean {
        if (status !== 200) {
            return true;
        }

        return html.includes('anomaly-modal__title');
    }

    private toDuckDuckGoLocale(region?: string): string | undefined {
        if (!region) {
            return undefined;
        }

        const normalized = region.replace('_', '-');
        const [language, country] = normalized.split('-');

        if (!language || !country) {
            return undefined;
        }

        return `${country.toLowerCase()}-${language.toLowerCase()}`;
    }

    private async delay(duration: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, duration));
    }
}
