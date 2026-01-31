import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { searchAllEngines } from './SearchAggregator.js';
import { renderPageToMarkdown } from './PageRenderer.js';
import { closeBrowserPool } from './BrowserPool.js';
import { cleanupOcr } from './PdfParser.js';

const server = new McpServer({
  name: 'serp-it',
  version: '1.0.1',
});

const searchResultSchema = z.object({
  title: z.string().describe('Title of the search result.'),
  url: z.string().describe('URL of the search result.'),
  snippet: z.string().describe('Snippet describing the search result.'),
  sources: z.array(z.string()).min(1).describe('Search engines that returned this result.'),
});

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  engineErrors: z.array(z.string()).optional(),
});

const searchFetchResultSchema = searchResultSchema.extend({
  markdown: z.string().describe('Page rendered to Markdown. Empty if rendering fails.'),
});

const searchFetchResponseSchema = z.object({
  results: z.array(searchFetchResultSchema),
  engineErrors: z.array(z.string()).optional(),
  fetchErrors: z.array(z.string()).optional(),
});

const fetchResponseSchema = z.object({
  url: z.string().describe('The URL that was fetched.'),
  markdown: z.string().describe('Page content rendered as Markdown.'),
});

// MCP Resource: Server capabilities
server.resource(
  'capabilities',
  'serp-it://capabilities',
  {
    description: 'Information about available search engines, features, and limits',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [
      {
        uri: 'serp-it://capabilities',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            engines: ['brave', 'duckduckgo', 'bing', 'yahoo', 'aol', 'startpage', 'yandex'],
            features: {
              multiEngineSearch: true,
              urlDeduplication: true,
              pageRendering: true,
              pdfSupport: true,
              regionSupport: true,
            },
            limits: {
              maxQueryLength: 500,
              maxFetchResults: 100,
              maxMarkdownLength: 40000,
            },
          },
          null,
          2,
        ),
      },
    ],
  }),
);

// MCP Prompts: Predefined search patterns for AI
server.prompt(
  'research',
  'Comprehensive research on a topic with full page content',
  {
    topic: z.string().describe('Research topic to investigate'),
    depth: z.number().optional().describe('Number of sources to fetch (1-20). Default: 5'),
  },
  async ({ topic, depth }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Research "${topic}" thoroughly. Use the search_fetch tool with maxFetch=${depth || 5} to gather comprehensive information from multiple sources. Analyze and synthesize the findings.`,
        },
      },
    ],
  }),
);

server.prompt(
  'fact-check',
  'Verify a claim using multiple sources',
  {
    claim: z.string().describe('Statement or claim to verify'),
  },
  async ({ claim }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Fact-check this claim: "${claim}". Use the search tool to find relevant sources, then use fetch on the most authoritative ones to verify accuracy. Cite your sources.`,
        },
      },
    ],
  }),
);

server.prompt(
  'compare-sources',
  'Compare how different sources cover a topic',
  {
    query: z.string().describe('Topic to compare across sources'),
  },
  async ({ query }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Search for "${query}" and compare how different sources cover this topic. Use search_fetch to get content from multiple sources, then analyze differences in perspective, coverage, and conclusions.`,
        },
      },
    ],
  }),
);

const ENGINES_COUNT = 7;

function getConfidenceLevel(sourceCount: number): string {
  if (sourceCount >= 3) return 'High';
  if (sourceCount >= 2) return 'Medium';
  return 'Low';
}

function renderSearchOutput(
  results: Array<{ title: string; url: string; sources: string[]; snippet: string }>,
  metadata: {
    query: string;
    region: string;
    enginesSucceeded: number;
    timestamp: string;
  },
): string {
  const lines: string[] = [];

  // Metadata section
  lines.push('<search-metadata>');
  lines.push(`Query: "${metadata.query}"`);
  lines.push(`Region: ${metadata.region}`);
  lines.push(`Results: ${results.length} found`);
  lines.push(`Engines: ${metadata.enginesSucceeded}/${ENGINES_COUNT} succeeded`);
  lines.push(`Timestamp: ${metadata.timestamp}`);
  lines.push('</search-metadata>');
  lines.push('');

  if (!results.length) {
    lines.push('<search-results>');
    lines.push('No results found.');
    lines.push('</search-results>');
    return lines.join('\n');
  }

  // Results section - sort by source count (confidence)
  lines.push('<search-results>');
  lines.push('');

  const sorted = [...results].sort((a, b) => b.sources.length - a.sources.length);

  for (const [index, item] of sorted.entries()) {
    const confidence = getConfidenceLevel(item.sources.length);
    const sourceList = item.sources.join(', ');

    lines.push(`## Result ${index + 1} (${confidence} Confidence)`);
    lines.push(`**Title:** ${item.title}`);
    lines.push(`**URL:** ${item.url}`);
    lines.push(`**Sources:** ${sourceList} (${item.sources.length} engine${item.sources.length > 1 ? 's' : ''})`);
    if (item.snippet) {
      lines.push(`**Snippet:** ${item.snippet}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('</search-results>');

  // Guidance section
  const highConfidence = sorted.filter((r) => r.sources.length >= 3);
  lines.push('');
  lines.push('<search-guidance>');
  lines.push('- Results sorted by confidence (engine agreement)');
  if (highConfidence.length > 0) {
    lines.push(`- High confidence results: #${highConfidence.map((_, i) => i + 1).join(', #')}`);
  }
  lines.push('- Use "fetch" tool on URLs for full page content');
  lines.push('</search-guidance>');

  return lines.join('\n');
}

function renderFetchOutput(
  url: string,
  title: string,
  markdown: string,
  metadata: { fetchedAt: string; contentLength: number; truncated: boolean },
): string {
  const lines: string[] = [];

  lines.push('<page-metadata>');
  lines.push(`URL: ${url}`);
  lines.push(`Title: ${title}`);
  lines.push(`Fetched: ${metadata.fetchedAt}`);
  lines.push(`Content: ${metadata.contentLength} characters${metadata.truncated ? ' (truncated)' : ''}`);
  lines.push('</page-metadata>');
  lines.push('');
  lines.push('<page-content>');
  lines.push('');
  lines.push(markdown);
  lines.push('');
  lines.push('</page-content>');

  return lines.join('\n');
}

function renderErrorOutput(toolName: string, error: string, context: Record<string, string>): string {
  const lines: string[] = [];
  lines.push('<error>');
  lines.push(`Tool: ${toolName}`);
  lines.push(`Error: ${error}`);
  for (const [key, value] of Object.entries(context)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('</error>');
  lines.push('');
  lines.push('<error-guidance>');
  lines.push('- Check if the query/URL is valid');
  lines.push('- Network issues may be temporary - retry may help');
  lines.push('- Try alternative search terms or different URL');
  lines.push('</error-guidance>');
  return lines.join('\n');
}

function truncateMarkdown(markdown: string, limit = 40_000): string {
  if (markdown.length <= limit) {
    return markdown;
  }

  return `${markdown.slice(0, limit)}\n\n... (truncated)`;
}

async function collectRenderedResults(
  query: string,
  region: string | undefined,
  fetchLimit: number,
) {
  const { results, engineErrors } = await searchAllEngines(query, region);

  if (!results.length) {
    return {
      results,
      enriched: [] as Array<z.infer<typeof searchFetchResultSchema>>,
      engineErrors,
      fetchErrors: [] as string[],
    };
  }

  const enriched = results.map((result) => ({ ...result, markdown: '' }));
  const fetchErrors: string[] = [];

  for (const item of enriched.slice(0, fetchLimit)) {
    try {
      const { markdown } = await renderPageToMarkdown(item.url);
      item.markdown = truncateMarkdown(markdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fetchErrors.push(`${item.url}: ${message}`);
    }
  }

  return { results, enriched, engineErrors, fetchErrors };
}

server.registerTool(
  'search',
  {
    title: 'Web Search',
    description:
      'Search the web across multiple engines (Brave, DuckDuckGo, Bing, Yahoo, AOL, Startpage, Yandex) and return deduplicated results. Use this for quick discovery of relevant URLs without fetching page content. Wrap important keywords in quotes for exact matching.',
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(500)
        .describe(
          'Search query. Use quotes for exact phrases: "climate change" impact 2024. Supports standard search operators.',
        ),
      region: z
        .string()
        .min(2)
        .max(16)
        .optional()
        .describe('Locale code for regional results. Examples: en-US, fr-FR, de-DE, ja-JP. Defaults to en-US.'),
    },
    outputSchema: searchResponseSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, region }) => {
    const regionCode = region?.trim() || 'en-US';

    try {
      const { results, engineErrors } = await searchAllEngines(query, regionCode);
      const structuredContent = {
        results,
        ...(engineErrors.length ? { engineErrors } : {}),
      };

      const metadata = {
        query,
        region: regionCode,
        enginesSucceeded: ENGINES_COUNT - engineErrors.length,
        timestamp: new Date().toISOString(),
      };

      const output = renderSearchOutput(results, metadata);
      const content: { type: 'text'; text: string }[] = [{ type: 'text', text: output }];

      if (engineErrors.length) {
        const errorText = engineErrors.map((e) => `- ${e}`).join('\n');
        content.push({ type: 'text', text: `<engine-errors>\n${errorText}\n</engine-errors>` });
      }

      return {
        structuredContent,
        content,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: renderErrorOutput('search', message, { query, region: region || 'en-US' }),
          },
        ],
      };
    }
  },
);

server.registerTool(
  'search_fetch',
  {
    title: 'Web Search With Page Capture',
    description:
      'Search the web and automatically fetch/render the top results as Markdown. Use this when you need both search results AND their full page content in one call. Best for research tasks requiring deep content analysis. Note: This is slower than "search" as it renders pages with a headless browser.',
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(500)
        .describe(
          'Search query. Use quotes for exact phrases: "climate change" impact 2024. Supports standard search operators.',
        ),
      region: z
        .string()
        .min(2)
        .max(16)
        .optional()
        .describe('Locale code for regional results. Examples: en-US, fr-FR, de-DE, ja-JP. Defaults to en-US.'),
      maxFetch: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Number of search results to fetch and render (1-100). Higher values = more content but slower. Default: 10.'),
    },
    outputSchema: searchFetchResponseSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ query, region, maxFetch }) => {
    const regionCode = region?.trim() || 'en-US';
    const fetchLimit = Math.min(Math.max(maxFetch ?? 10, 1), 100);

    try {
      const { results, enriched, engineErrors, fetchErrors } = await collectRenderedResults(
        query,
        regionCode,
        fetchLimit,
      );

      const structuredContent = {
        results: enriched,
        ...(engineErrors.length ? { engineErrors } : {}),
        ...(fetchErrors.length ? { fetchErrors } : {}),
      } satisfies z.infer<typeof searchFetchResponseSchema>;

      const metadata = {
        query,
        region: regionCode,
        enginesSucceeded: ENGINES_COUNT - engineErrors.length,
        timestamp: new Date().toISOString(),
      };

      const content: { type: 'text'; text: string }[] = [];

      // Search results summary
      content.push({ type: 'text', text: renderSearchOutput(results, metadata) });

      // Page contents
      for (const item of enriched.slice(0, fetchLimit)) {
        if (!item.markdown) continue;

        const pageOutput = renderFetchOutput(item.url, item.title, item.markdown, {
          fetchedAt: new Date().toISOString(),
          contentLength: item.markdown.length,
          truncated: item.markdown.includes('... (truncated)'),
        });
        content.push({ type: 'text', text: pageOutput });
      }

      if (content.length === 1) {
        content.push({ type: 'text', text: '<search-notice>No page content was captured.</search-notice>' });
      }

      if (engineErrors.length) {
        const errorText = engineErrors.map((e) => `- ${e}`).join('\n');
        content.push({ type: 'text', text: `<engine-errors>\n${errorText}\n</engine-errors>` });
      }

      if (fetchErrors.length) {
        const errorText = fetchErrors.map((e) => `- ${e}`).join('\n');
        content.push({ type: 'text', text: `<fetch-errors>\n${errorText}\n</fetch-errors>` });
      }

      return {
        structuredContent,
        content,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: renderErrorOutput('search_fetch', message, { query, region: region || 'en-US' }),
          },
        ],
      };
    }
  },
);

server.registerTool(
  'fetch',
  {
    title: 'Fetch and Render Single Page',
    description:
      'Fetch a single URL and render its content as Markdown. Supports HTML pages and PDF documents. Use this to read a specific page you already know the URL for. For discovering URLs, use "search" first.',
    inputSchema: {
      url: z
        .string()
        .url()
        .describe('The URL to fetch and render. Must be a valid HTTP/HTTPS URL.'),
    },
    outputSchema: fetchResponseSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ url }) => {
    try {
      const { markdown } = await renderPageToMarkdown(url);
      const truncatedMarkdown = truncateMarkdown(markdown);
      const isTruncated = truncatedMarkdown.includes('... (truncated)');

      const structuredContent = {
        url,
        markdown: truncatedMarkdown,
      } satisfies z.infer<typeof fetchResponseSchema>;

      const output = renderFetchOutput(url, url, truncatedMarkdown, {
        fetchedAt: new Date().toISOString(),
        contentLength: truncatedMarkdown.length,
        truncated: isTruncated,
      });

      return {
        structuredContent,
        content: [{ type: 'text', text: output }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: renderErrorOutput('fetch', message, { url }),
          },
        ],
      };
    }
  },
);

const shutdown = async () => {
  try {
    await closeBrowserPool();
    await cleanupOcr();
    await server.close();
  } catch (error) {
    console.error('Error shutting down MCP server:', error);
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('serp-it MCP server is ready for requests.');
}

main().catch((error) => {
  console.error('serp-it MCP crashed:', error);
  process.exit(1);
});

