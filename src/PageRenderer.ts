import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';
import { getBrowserPool, getChromiumLaunchOptions } from './BrowserPool.js';
import { Page } from "playwright";
import { parsePdfFromUrl, isPdfUrl, isPdfContentType } from './PdfParser.js';

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
});

turndown.use(turndownPluginGfm.gfm);

const MAX_ATTEMPTS = 3;
const NAV_TIMEOUT_MS = 15_000;

export interface PageRenderResult {
  html: string;
  markdown: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertHtmlToMarkdown(page: Page, html: string): Promise<string> {
  try {
    return turndown.turndown(html);
  } catch (error) {
    const fallback = await page.locator('body').innerText().catch(() => undefined);
    if (fallback && fallback.trim()) {
      return fallback.trim();
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to convert HTML to Markdown: ${message}`);
  }
}

export async function renderPageToMarkdown(url: string, usePool = true): Promise<PageRenderResult> {
  // Check if URL is a PDF
  if (isPdfUrl(url) || await isPdfContentType(url)) {
    try {
      const markdown = await parsePdfFromUrl(url);
      return { html: '', markdown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`PDF rendering failed: ${message}`);
    }
  }

  // Regular HTML page rendering
  let lastError: unknown;
  const pool = usePool ? getBrowserPool() : null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let browser = pool ? await pool.acquire() : null;
    let createdBrowser = false;

    try {
      if (!browser) {
        const { chromium } = await import('playwright');
        browser = await chromium.launch(getChromiumLaunchOptions());
        createdBrowser = true;
      }

      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

      const html = await page.content();
      const markdown = await convertHtmlToMarkdown(page, html);

      await context.close();

      if (pool && !createdBrowser) {
        pool.release(browser);
      } else if (createdBrowser) {
        await browser.close();
      }

      return { html, markdown };
    } catch (error) {
      lastError = error;

      if (browser) {
        if (pool && !createdBrowser) {
          pool.release(browser);
        } else if (createdBrowser) {
          await browser.close().catch(() => {});
        }
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        await delay(250 * (attempt + 1));
      }
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : `Unknown error rendering ${url}`;
  throw new Error(message);
}
