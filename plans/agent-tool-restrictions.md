# Plan: Centralized Agent Tool Permissions (Allowlist)

## Context

Tool restrictions are currently scattered across 3 agent files (`chat.ts`, `search-agent.ts`, `indexer.ts`), each manually maintaining its own blocklist. This is fragile — when a new willow tool is added, every agent's blocklist must be updated or the new tool leaks through. We'll centralize permissions using an **allowlist** approach: each agent declares only the tools it CAN use, and the disallowed list is computed automatically. `BLOCKED_BUILTIN_TOOLS` (the Claude CLI workaround) stays as-is.

## Agent Tool Domains

| Agent | Allowed Willow Tools | Purpose |
|-------|---------------------|---------|
| **chat** | `get_context` | Read-only recall (search done by search agent) |
| **search** | `search_nodes`, `get_context` | Read-only graph exploration |
| **indexer** | All 6 tools | Read + write for knowledge extraction |
| **maintenance** | All 6 tools | Read + write for graph cleanup/optimization |

## Changes

### 1. Create `packages/chat/src/server/services/agent-tools.ts`

Central agent tool permission registry:

```ts
import { BLOCKED_BUILTIN_TOOLS } from "./cli-chat.js";

// All willow MCP tools — single source of truth
const ALL_WILLOW_TOOLS = [
  "mcp__willow__search_nodes",
  "mcp__willow__get_context",
  "mcp__willow__create_node",
  "mcp__willow__update_node",
  "mcp__willow__delete_node",
  "mcp__willow__add_link",
] as const;

type AgentName = "chat" | "search" | "indexer" | "maintenance";

// Allowlist: each agent declares ONLY the willow tools it may use
const AGENT_ALLOWED_TOOLS: Record<AgentName, readonly string[]> = {
  chat:        ["mcp__willow__get_context"],
  search:      ["mcp__willow__search_nodes", "mcp__willow__get_context"],
  indexer:     [...ALL_WILLOW_TOOLS],
  maintenance: [...ALL_WILLOW_TOOLS],
};

/**
 * Returns the full disallowed tools list for an agent:
 * BLOCKED_BUILTIN_TOOLS + any willow tools NOT in the agent's allowlist.
 */
export function getDisallowedTools(agent: AgentName): string[] {
  const allowed = new Set(AGENT_ALLOWED_TOOLS[agent]);
  const blockedWillow = ALL_WILLOW_TOOLS.filter((t) => !allowed.has(t));
  return [...BLOCKED_BUILTIN_TOOLS, ...blockedWillow];
}
```

### 2. Update `packages/chat/src/server/routes/chat.ts`

- Remove the `CHAT_DISALLOWED_TOOLS` array (lines 48-55)
- Import `getDisallowedTools` from `agent-tools.ts`
- Replace `disallowedTools: CHAT_DISALLOWED_TOOLS` with `disallowedTools: getDisallowedTools("chat")`

### 3. Update `packages/chat/src/server/services/search-agent.ts`

- Remove the `SEARCH_DISALLOWED_TOOLS` array (lines 34-40)
- Import `getDisallowedTools` from `agent-tools.ts`
- Replace `...SEARCH_DISALLOWED_TOOLS` in the args array (line 84) with `...getDisallowedTools("search")`

### 4. Update `packages/chat/src/server/services/indexer.ts`

- Import `getDisallowedTools` from `agent-tools.ts`
- Replace `...BLOCKED_BUILTIN_TOOLS` in the args array (line 80) with `...getDisallowedTools("indexer")`
- Remove the `BLOCKED_BUILTIN_TOOLS` import (no longer needed directly)

### 5. Future: `maintenance.ts`

When the maintenance agent is built, it will simply use `getDisallowedTools("maintenance")` — no need to manually track tool permissions.

## Key Files

| File | Action |
|------|--------|
| `packages/chat/src/server/services/agent-tools.ts` | **Create** — central registry |
| `packages/chat/src/server/routes/chat.ts` | **Modify** — use registry for chat agent |
| `packages/chat/src/server/services/search-agent.ts` | **Modify** — use registry for search agent |
| `packages/chat/src/server/services/indexer.ts` | **Modify** — use registry for indexer agent |
| `packages/chat/src/server/services/cli-chat.ts` | **No change** — `BLOCKED_BUILTIN_TOOLS` stays here, still exported |

## Verification

1. `pnpm typecheck` — ensure no type errors
2. `pnpm build` — full build passes
3. `pnpm dev` — start the app, send a message, verify:
   - Search agent: makes `search_nodes`/`get_context` calls only
   - Chat agent: makes `get_context` calls only (no search_nodes)
   - Indexer agent: makes create/update/delete/add_link calls as needed
4. Check tool call events in browser devtools (SSE stream) to confirm no unexpected tools appear
