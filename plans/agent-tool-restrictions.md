# Plan: Centralized Agent Tool Permissions (Allowlist)

## Status: IMPLEMENTED

## Context

Tool restrictions were scattered across 4 agent files, each manually maintaining its own blocklist. When VCS tools (`commit`, `graph_log`, `show_commit`) were added, no blocklist was updated — they leaked through to all agents. We centralized permissions using an **allowlist** approach in `agent-tools.ts`.

## All Willow MCP Tools (9 total)

**Graph tools (6):** `search_nodes`, `get_context`, `create_node`, `update_node`, `delete_node`, `add_link`
**VCS tools (3):** `commit`, `graph_log`, `show_commit`

## Agent Tool Domains

| Agent | Willow Tools | Other Tools | Purpose |
|-------|-------------|-------------|---------|
| **chat** | _(none)_ | `search_memories`, `view_image` (coordinator) | Conversational — delegates all graph access to search agent |
| **search** | `search_nodes`, `get_context` | _(none)_ | Read-only graph exploration |
| **indexer** | `search_nodes`, `create_node`, `update_node`, `delete_node`, `add_link` | _(none)_ | Graph writes for knowledge extraction (commit handled by orchestrator) |
| **maintenance** | `search_nodes`, `get_context`, `create_node`, `update_node`, `delete_node`, `add_link` | _(none)_ | Direct graph cleanup (commit handled by orchestrator, no coordinator overhead) |

## Changes Made

### 1. Created `packages/chat/src/server/services/agent-tools.ts`

Central registry with `BLOCKED_BUILTIN_TOOLS`, `ALL_WILLOW_TOOLS`, and `getDisallowedTools(agent)`.

### 2. Updated `packages/chat/src/server/services/cli-chat.ts`

- Moved `BLOCKED_BUILTIN_TOOLS` to `agent-tools.ts`, re-exports for backward compat
- Coordinator MCP inline `BLOCKED` list now uses `getDisallowedTools("search")`

### 3. Updated `packages/chat/src/server/routes/chat.ts`

- Removed `CHAT_DISALLOWED_TOOLS` array
- Uses `getDisallowedTools("chat")` — blocks ALL willow tools (chat has no direct graph access)
- Removed `get_context` reference from system prompt

### 4. Updated `packages/chat/src/server/services/search-agent.ts`

- Removed `SEARCH_DISALLOWED_TOOLS` array
- Uses `getDisallowedTools("search")` — now also blocks VCS tools

### 5. Updated `packages/chat/src/server/services/indexer.ts`

- Uses `getDisallowedTools("indexer")` — blocks `get_context` + all VCS tools

### 6. Updated `packages/chat/src/server/services/maintenance.ts`

- Removed coordinator MCP and event socket — maintenance now calls `search_nodes` directly
- Uses `getDisallowedTools("maintenance")` — blocks all VCS tools
- Updated system prompt: `search_memories` → `search_nodes`

## Key Design Decisions

- **Chat gets zero willow tools.** `search_memories` (coordinator) is its only graph access path.
- **No agent gets VCS tools.** Both indexer and maintenance commits are handled programmatically by their orchestrators (`agentic-stream.ts` and `maintenance.ts` respectively).
- **Maintenance dropped the coordinator.** Direct `search_nodes` is simpler and avoids spawning a search agent subprocess.
- **Indexer dropped `get_context`.** Search results include node IDs and paths — sufficient for placement decisions.
