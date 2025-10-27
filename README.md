# serp-it

serp-it is an MCP (Model Context Protocol) server that exposes web search and optional page rendering capabilities through a simple stdio interface.

## Features
- 🔍 **Multi-Engine Search**: Aggregates results from 7 search engines (AOL, Brave, Bing, DuckDuckGo, Yahoo, Startpage, Yandex)
- 📄 **PDF Support**: Automatically detects and extracts text from PDF documents
- 🌐 **Page Rendering**: Converts web pages to Markdown using headless Chromium
- ♻️ **Browser Pooling**: Efficient browser instance management for better performance
- 🗺️ **Region Support**: Search with locale/region codes (e.g., en-US, en-GB)
- 🔄 **Result Deduplication**: Merges duplicate results across engines
- 📦 **Docker Ready**: Includes Dockerfile for deployment with supergateway

## AOL Search Integration
The AOL search engine often flies under the radar but returns unique SERP blends that combine Yahoo ranking signals with syndicated content. serp-it includes first-class AOL support with the following behavior:
- Requests are issued against `https://search.aol.com/aol/search` with JavaScript disabled (`nojs=1`) so that results are stable for scraping.
- Region hints are translated into `Accept-Language` headers (`en_US` -> `en-US`), giving you localized snippets where AOL supports them.
- Result URLs are unwrapped with the same redirect decoder used for Yahoo, ensuring clean, direct links instead of AOL's tracking intermediaries.
- Duplicate links within the same result set are filtered before they reach the aggregator, protecting downstream clients from redundant entries.

If AOL should be temporarily disabled (for example during rate limiting) you can comment it out in `src/SearchAggregator.ts` and the rest of the stack will continue operating.

## Supported Engines
| Engine | File | Notes |
| --- | --- | --- |
| AOL | `src/engines/Aol.ts` | HTML response, Yahoo-style redirect cleanup. |
| Brave | `src/engines/Brave.ts` | Rapid updates, privacy-focused snippets. |
| Bing | `src/engines/Bing.ts` | Provides richer entity cards. |
| DuckDuckGo | `src/engines/DuckDuckGo.ts` | No personalization, global focus. |
| Yahoo | `src/engines/Yahoo.ts` | Often mirrors AOL but with different ordering. |
| Startpage | `src/engines/Startpage.ts` | Google-backed privacy results. |
| Yandex | `src/engines/Yandex.ts` | Strong non-English indexing. |

## Installation
```bash
npm install
npm run build
```

### Playwright Setup
```bash
# Install Chromium used by Playwright
npm run playwright:install

# (Linux/WSL) install required system libraries
npm run playwright:install-deps
```

## Usage
### Run as MCP Server (stdio)
```bash
npm start
```
The server exchanges JSON-RPC 2.0 messages over stdio.

### Tools
- `search`: Aggregate results from the configured engines.
- `search_fetch`: Search and render the top matches to Markdown.

Inputs:
- `query` (required string): Search query text.
- `region` (optional string): Locale code such as `en-US` or `fr-FR`.
- `maxFetch` (optional number, `search_fetch` only): Number of rendered pages (default 5, max 10).

Outputs:
- Array of enriched search results (title, URL, snippet, engine metadata).
- Separate error lists for engine failures and fetch/render issues.

## Development
```bash
# Rebuild on change
npm run dev

# Remove build artefacts
npm run clean

# Full clean build
npm run rebuild

# Run the integration tests
npm test
```

## Docker Deployment
### With supergateway
```bash
docker build -t serp-it-mcp .
docker run -p 8080:8080 serp-it-mcp
```
The container image bundles the MCP server alongside supergateway to expose SSE/HTTP endpoints on port 8080.

### Environment Variables
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: Override the Chromium binary path.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`: Set to `1` to reuse a preinstalled browser.

## Configuration
### Claude Desktop
Add the server to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "serp-it": {
      "command": "node",
      "args": ["/path/to/serp-it/dist/index.js"]
    }
  }
}
```

### Generic MCP Client (TypeScript)
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./dist/index.js']
});

const client = new Client({
  name: 'my-client',
  version: '1.0.0'
}, {
  capabilities: {}
});

await client.connect(transport);
```

## Project Structure
- `src/index.ts`: Entry point for the MCP server.
- `src/SearchAggregator.ts`: Orchestrates engines and deduplication.
- `src/PageRenderer.ts`: Manages Playwright rendering and Markdown conversion.
- `src/PdfParser.ts`: Converts downloaded PDFs into text.
- `src/BrowserPool.ts`: Pools Chromium instances.
- `src/ISearchEngine.ts`: Interface definition for search engines.
- `src/SearchResult.ts`: Result data structure shared across engines.
- `src/EngineUtils.ts`: Shared scraping helpers.
- `src/engines/Aol.ts`: AOL search implementation.
- `src/engines/Brave.ts`: Brave search implementation.
- `src/engines/Bing.ts`: Bing search implementation.
- `src/engines/DuckDuckGo.ts`: DuckDuckGo search implementation.
- `src/engines/Yahoo.ts`: Yahoo search implementation.
- `src/engines/Startpage.ts`: Startpage search implementation.
- `src/engines/Yandex.ts`: Yandex search implementation.

## License
ISC

## Repository
https://github.com/luka-dev/serp-it
