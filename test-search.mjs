#!/usr/bin/env node

import { spawn } from 'child_process';

const serverPath = './dist/index.js';

console.log('Starting MCP server test...\n');

const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let responseBuffer = '';

server.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  try {
    const messages = responseBuffer.split('\n').filter(line => line.trim());
    for (const msg of messages) {
      if (msg.trim()) {
        const parsed = JSON.parse(msg);
        console.log('Server response:', JSON.stringify(parsed, null, 2));
      }
    }
    responseBuffer = '';
  } catch (e) {
    // Buffer incomplete JSON
  }
});

server.stderr.on('data', (data) => {
  console.error('Server stderr:', data.toString());
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(code);
});

// Wait for server to start
setTimeout(() => {
  console.log('\n1. Testing tools/list...');
  const listRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  };
  server.stdin.write(JSON.stringify(listRequest) + '\n');

  setTimeout(() => {
    console.log('\n2. Testing search tool...');
    const searchRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: {
          query: 'typescript mcp server',
          region: 'en-US'
        }
      }
    };
    server.stdin.write(JSON.stringify(searchRequest) + '\n');

    setTimeout(() => {
      console.log('\nTest completed. Terminating server...');
      server.kill('SIGTERM');
    }, 15000);
  }, 2000);
}, 1000);
