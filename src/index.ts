import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { searchAllEngines } from './SearchAggregator.js';
import { renderPageToMarkdown } from './PageRenderer.js';
import { closeBrowserPool } from './BrowserPool.js';

const server = new McpServer({
  name: 'google-it',
  version: '0.0.1',
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


function renderSummary(results: Array<{ title: string; url: string; sources: string[]; snippet: string }>): string {
  return results
    .map((item, index) => {
      const engines = item.sources.join(', ');
      const snippet = item.snippet ? `\n${item.snippet}` : '';
      return `${index + 1}. [${engines}] ${item.title}\n${item.url}${snippet}`;
    })
    .join('\n\n');
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
    description: 'Fetch search results from multiple engines and merge them. Wrap the most important keywords in quotes (\").',
    inputSchema: {
      query: z.string().min(1).max(500).describe('Text to search for.'),
      region: z
        .string()
        .min(2)
        .max(16)
        .optional()
        .describe('Optional locale code such as en-US.'),
    },
    outputSchema: searchResponseSchema.shape,
  },
  async ({ query, region }) => {
    const regionCode = region?.trim() || 'en-US';

    try {
      const { results, engineErrors } = await searchAllEngines(query, regionCode);
      const structuredContent = {
        results,
        ...(engineErrors.length ? { engineErrors } : {}),
      };

      const summary = renderSummary(results);

      const content = [] as { type: 'text'; text: string }[];

      if (summary) {
        content.push({ type: 'text', text: summary });
      } else {
        content.push({ type: 'text', text: 'No results found.' });
      }

      if (engineErrors.length) {
        const errorText = engineErrors.map((error) => `- ${error}`).join('\n');
        content.push({ type: 'text', text: `Engine errors:\n${errorText}` });
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
            text: `Search failed: ${message}`,
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
      'Search the web, then render the top results with a headless Chrome browser and convert them to Markdown for downstream consumption.',
    inputSchema: {
      query: z.string().min(1).max(500).describe('Text to search for.'),
      region: z
        .string()
        .min(2)
        .max(16)
        .optional()
        .describe('Optional locale code such as en-US.'),
      maxFetch: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum number of results to render. Defaults to 10.'),
    },
    outputSchema: searchFetchResponseSchema.shape,
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

      const summary = renderSummary(results);
      const content = [] as { type: 'text'; text: string }[];

      if (summary) {
        content.push({ type: 'text', text: summary });
      }

      for (const item of enriched.slice(0, fetchLimit)) {
        if (!item.markdown) {
          continue;
        }

        const heading = `# ${item.title}\n${item.url}`;
        content.push({ type: 'text', text: `${heading}\n\n${item.markdown}` });
      }

      if (!content.length) {
        content.push({ type: 'text', text: 'Search completed but no content was captured.' });
      }

      if (engineErrors.length) {
        const errorText = engineErrors.map((error) => `- ${error}`).join('\n');
        content.push({ type: 'text', text: `Engine errors:\n${errorText}` });
      }

      if (fetchErrors.length) {
        const errorText = fetchErrors.map((error) => `- ${error}`).join('\n');
        content.push({ type: 'text', text: `Fetch errors:\n${errorText}` });
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
            text: `Search fetch failed: ${message}`,
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
      'Fetch a single URL and render it to Markdown using a headless Chrome browser. Supports both HTML pages and PDF documents.',
    inputSchema: {
      url: z
        .string()
        .url()
        .describe('The URL to fetch and render.'),
    },
    outputSchema: fetchResponseSchema.shape,
  },
  async ({ url }) => {
    try {
      const { markdown } = await renderPageToMarkdown(url);
      const truncatedMarkdown = truncateMarkdown(markdown);

      const structuredContent = {
        url,
        markdown: truncatedMarkdown,
      } satisfies z.infer<typeof fetchResponseSchema>;

      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: `# ${url}\n\n${truncatedMarkdown}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Fetch failed: ${message}`,
          },
        ],
      };
    }
  },
);

const shutdown = async () => {
  try {
    await closeBrowserPool();
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
  console.error('google-it MCP server is ready for requests.');
}

main().catch((error) => {
  console.error('Google-It MCP crashed:', error);
  process.exit(1);
});

