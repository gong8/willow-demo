# Willow

Willow is a knowledge graph system for AI memory. Claude uses MCP tools to store, search, and connect facts about the user across conversations. The graph is a tree of nodes (categories and details) with cross-cutting links between them. Willow-core includes a git-like VCS (branches, commits, merging, diffs) for the knowledge graph.

## Architecture

```
React chat UI (assistant-ui) → Hono backend → Claude CLI (via MCP) → willow-mcp-server → willow-core (Rust NAPI)
```

- Conversations and attachments are stored in SQLite via Prisma (`packages/chat`)
- The knowledge graph is persisted as JSON at `~/.willow/graph.json` (configurable via `WILLOW_GRAPH_PATH`)
- Vite dev server on port 5173 proxies `/api/*` to Hono on port 8787

## Monorepo structure

| Path | Description |
|---|---|
| `crates/willow-core` | Rust NAPI module — graph storage, search, VCS (branches, commits, merge, diff). Compiles to a `.node` binary via napi-rs v3. |
| `packages/shared` | Zod schemas for MCP tool inputs. Shared between `mcp-server` and `chat`. |
| `packages/mcp-server` | MCP server (stdio transport) exposing 8 graph tools to Claude: `search_nodes`, `get_context`, `create_node`, `update_node`, `delete_node`, `add_link`, `delete_link`, `walk_graph`. |
| `packages/chat` | Full-stack app — React + Hono + Prisma/SQLite. Uses assistant-ui for the chat interface and reagraph for graph visualization. Routes: `/chat` (conversations), `/chat/attachments`, `/graph` (VCS operations). |

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

Rust (napi-rs v3), TypeScript, Hono, React 19, Vite 6, Prisma/SQLite, reagraph, Tailwind CSS 4, assistant-ui, TanStack Query, Biome, Turbo, pnpm
