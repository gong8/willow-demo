# Willow

Willow is a knowledge graph system for AI memory. Claude uses MCP tools to store, search, and connect facts about the user across conversations. The graph is a tree of nodes (categories and details) with cross-cutting links between them.

## Architecture

```
React chat UI (assistant-ui) → Hono backend → Claude CLI (via MCP) → willow-mcp-server → willow-core (Rust NAPI)
```

- Conversations are stored in SQLite via Prisma (`packages/chat`)
- The knowledge graph is persisted as JSON at `~/.willow/graph.json` (configurable via `WILLOW_GRAPH_PATH`)

## Monorepo structure

| Path | Description |
|---|---|
| `crates/willow-core` | Rust NAPI module — graph storage, search, versioning. Compiles to a `.node` binary via napi-rs. |
| `packages/shared` | Zod schemas for MCP tool inputs. Shared between `mcp-server` and `chat`. |
| `packages/mcp-server` | MCP server (stdio transport) exposing 6 graph tools to Claude: `search_nodes`, `get_context`, `create_node`, `update_node`, `delete_node`, `add_link`. |
| `packages/chat` | Full-stack app — React + Hono + Prisma/SQLite. Uses assistant-ui for the chat interface and Reagraph for graph visualization. |

## Common commands

```sh
pnpm install      # install dependencies
pnpm build        # build all packages (turbo)
pnpm dev          # run dev servers (turbo, persistent)
pnpm lint         # check with biome
pnpm lint:fix     # auto-fix with biome
pnpm test         # run tests (turbo)
pnpm typecheck    # typecheck all packages (turbo)
```

## Tech stack

Rust (napi-rs), TypeScript, Hono, React, Vite, Prisma/SQLite, Reagraph, Tailwind, Biome, Turbo, pnpm
