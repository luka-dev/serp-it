#!/bin/sh
# Wrapper script to start supergateway with the google-it MCP server

exec npx -y @modelcontextprotocol/supergateway \
  --sse \
  --port 8080 \
  --host 0.0.0.0 \
  -- node /workspace/dist/index.js
