# Willow

Willow is a knowledge graph system for AI memory. It lets Claude store, search, and connect facts about users across conversations through MCP tools. The graph is a tree of typed nodes with cross-cutting links between them, backed by a built-in version control system.

## Architecture

```
React chat UI (assistant-ui) --> Hono backend --> Claude CLI (via MCP) --> willow-mcp-server --> willow-core (Rust NAPI)
```

- **Chat frontend**: React 19 with assistant-ui, served by Vite on port 5173
- **API server**: Hono on port 8787, proxied from Vite during development
- **Conversations**: Stored in SQLite via Prisma
- **Knowledge graph**: Persisted as JSON at `~/.willow/graph.json` (configurable via `WILLOW_GRAPH_PATH`)
- **Graph visualization**: reagraph for interactive node/link rendering

## Project Structure

```
crates/
  willow-core/       Rust NAPI module -- graph storage, search, and VCS
packages/
  shared/            Zod schemas shared between mcp-server and chat
  mcp-server/        MCP server (stdio) exposing graph tools to Claude
  chat/              Full-stack chat app (React + Hono + Prisma)
```

## Prerequisites

- [Rust](https://rustup.rs/) (for building willow-core)
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9)

## Setup

```sh
git clone <repo-url> && cd willow-demo
pnpm install
cp packages/chat/.env.example packages/chat/.env
pnpm build
pnpm --filter @willow/chat db:push   # create the SQLite database
pnpm dev
```

### Environment Variables

Prisma requires a `packages/chat/.env` file with `DATABASE_URL`. The other variables are read from `process.env` at runtime and have sensible defaults — set them in your shell or a tool like [direnv](https://direnv.net/) if you need to override.

| Variable | Default | Where | Description |
|---|---|---|---|
| `DATABASE_URL` | `file:./data/willow.db` | `packages/chat/.env` | Prisma SQLite path (relative to `packages/chat`) |
| `PORT` | `8787` | shell env | Hono server port |
| `LLM_MODEL` | `claude-opus-4-6` | shell env | Claude model used for chat |
| `WILLOW_GRAPH_PATH` | `~/.willow/graph.json` | shell env | Path to the knowledge graph file |

## Development

```sh
pnpm dev          # start Vite + Hono dev servers
pnpm build        # build all packages
pnpm test         # run tests
pnpm typecheck    # typecheck all packages
pnpm lint         # check with Biome
pnpm lint:fix     # auto-fix with Biome
```

## MCP Tools

The MCP server exposes 8 tools for graph manipulation:

| Tool | Description |
|---|---|
| `search_nodes` | Search the graph for nodes matching a query |
| `get_context` | Get a node with its ancestors and descendants |
| `create_node` | Create a new node in the graph |
| `update_node` | Update a node's content or metadata |
| `delete_node` | Delete a node and its descendants |
| `add_link` | Create a directional link between nodes |
| `delete_link` | Remove a link between nodes |
| `walk_graph` | Navigate the tree interactively |

## Tech Stack

- **Core**: Rust (napi-rs v3)
- **Backend**: Hono, Prisma, SQLite
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, assistant-ui, reagraph, TanStack Query
- **Tooling**: TypeScript, Biome, Turbo, pnpm, Vitest
