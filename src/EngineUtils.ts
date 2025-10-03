import { CheerioAPI, load } from "cheerio";

const DEFAULT_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
};

export interface FetchedPage {
  html: string;
  $: CheerioAPI;
  response: Response;
}

function toHeaders(init?: HeadersInit): Headers {
  const headers = new Headers();
  if (!init) {
    return headers;
  }

  if (init instanceof Headers) {
    init.forEach((value, key) => headers.set(key, value));
    return headers;
  }

  if (Array.isArray(init)) {
    for (const [key, value] of init) {
      if (value !== undefined) {
        headers.set(key, value);
      }
    }
    return headers;
  }

  for (const [key, value] of Object.entries(init)) {
    if (value !== undefined) {
      headers.set(key, value as string);
    }
  }

  return headers;
}

export async function fetchCheerio(
  url: string,
  init: RequestInit = {},
  extraHeaders: HeadersInit = {},
): Promise<FetchedPage> {
  const headers = new Headers(DEFAULT_HEADERS);

  const extra = toHeaders(extraHeaders);
  extra.forEach((value, key) => headers.set(key, value));

  if (init.headers) {
    const custom = toHeaders(init.headers);
    custom.forEach((value, key) => headers.set(key, value));
  }

  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers,
  });

  const html = await response.text();
  const $ = load(html);

  return { html, $, response };
}

function parseCookiePair(cookie: string): [string, string] | null {
  const [nameValue] = cookie.split(";");
  if (!nameValue) {
    return null;
  }

  const eqIndex = nameValue.indexOf("=");
  if (eqIndex === -1) {
    return null;
  }

  const name = nameValue.slice(0, eqIndex).trim();
  const value = nameValue.slice(eqIndex + 1).trim();

  if (!name) {
    return null;
  }

  return [name, value];
}

export function buildCookieHeader(
  ...cookieLists: (string[] | undefined)[]
): string | undefined {
  const jar = new Map<string, string>();

  for (const cookies of cookieLists) {
    if (!cookies) {
      continue;
    }

    for (const cookie of cookies) {
      const pair = parseCookiePair(cookie);
      if (pair) {
        jar.set(pair[0], pair[1]);
      }
    }
  }

  if (!jar.size) {
    return undefined;
  }

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function decodeGoogleRedirectUrl(href: string): string {
  if (!href) {
    return href;
  }

  if (href.startsWith("/url?q=")) {
    const stripped = href.slice(7);
    const [target] = stripped.split("&sa=");
    try {
      return decodeURIComponent(target);
    } catch (error) {
      return target;
    }
  }

  return href;
}

export function decodeBingRedirectUrl(url: string): string {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url, "https://www.bing.com");
    const encoded = parsed.searchParams.get("u");

    if (!encoded) {
      return url;
    }

    const trimmed = encoded.length > 2 ? encoded.slice(2) : encoded;
    const padding = (4 - (trimmed.length % 4)) % 4;
    const padded = trimmed + "=".repeat(padding);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");

    return decoded;
  } catch (error) {
    return url;
  }
}

export function decodeYahooRedirectUrl(url: string): string {
  if (!url) {
    return url;
  }

  const ruMarker = "/RU=";
  const ruIndex = url.indexOf(ruMarker);

  if (ruIndex === -1) {
    return url;
  }

  const after = url.slice(ruIndex + ruMarker.length);
  const endIndex = after.indexOf("/R");
  const encoded = endIndex === -1 ? after : after.slice(0, endIndex);

  try {
    return decodeURIComponent(encoded);
  } catch (error) {
    return encoded;
  }
}
