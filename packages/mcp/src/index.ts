#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

// Local stdio MCP server — the entry point invoked by MCP clients
// (Claude Code/Desktop, Codex, Cursor) via `npx @aspicio/mcp`.
const server = createServer();
await server.connect(new StdioServerTransport());
