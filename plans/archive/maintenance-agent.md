# Maintenance Agent Plan

## Context

The Willow knowledge graph grows with every conversation as the indexer agent adds new facts. Over time this leads to duplicate nodes, contradictions, expired temporal facts, orphaned nodes, and unbalanced category trees. A maintenance agent will periodically clean up and optimize the graph automatically.

## Architecture

Same pattern as the indexer: a background Claude CLI subprocess with MCP access to the graph. Key differences:
- **Model**: `opus` (same as indexer — maintenance decisions require strong reasoning)
- **Max turns**: `25` (more complex multi-step work)
- **Trigger**: Both periodic (every N conversations) and manual (button in graph toolbar)
- **Scope**: Global (single job at a time, not per-conversation)
- **Graph dump**: Reads `~/.willow/graph.json` and passes it in the prompt so the agent can analyze the full state

## Files to Create

### 1. `packages/chat/src/server/services/maintenance.ts`

Core service following the indexer pattern:
- `MAINTENANCE_SYSTEM_PROMPT` — instructs the agent to perform 5 operations in order:
  1. **Orphan cleanup** — find nodes not in any parent's children array, delete them
  2. **Temporal expiry** — find facts with expired `valid_until`, delete or mark expired
  3. **Duplicate merging** — find semantically similar nodes, keep the better one
  4. **Contradiction detection** — find conflicting facts, resolve by recency/confidence
  5. **Category rebalancing** — split oversized categories, flatten over-nested ones
- `MaintenanceJob` interface — like `IndexerJob` but with `trigger: "periodic" | "manual"` field
- Single `currentJob` variable (not a Map — only one maintenance run at a time)
- `conversationsSinceLastMaintenance` counter + `MAINTENANCE_THRESHOLD` from env (default `5`)
- `runMaintenance(options)` — guards against concurrent runs, reads graph JSON, spawns CLI
- `notifyConversationComplete(mcpServerPath)` — increments counter, auto-triggers when threshold reached
- `getMaintenanceStatus()` — returns current job or null
- Size guard: if graph dump > 100KB, fall back to search-based prompt (no dump)

### 2. `packages/chat/src/client/hooks/useMaintenanceStatus.ts`

Polling hook (same pattern as `useIndexerStatus`):
- Polls `GET /api/chat/maintenance/status`
- 2s interval when active, 15s when idle (slower than indexer since maintenance is less frequent)

### 3. `packages/chat/src/client/components/graph/MaintenanceIndicator.tsx`

UI component in the graph toolbar:
- "Maintain" button with wrench icon (uses existing lucide-react icons)
- Shows spinner when running, disables button during run
- Expandable dropdown showing tool calls (same pattern as `IndexerIndicator`)
- Invalidates graph query cache on completion

## Files to Modify

### 4. `packages/chat/src/server/routes/chat.ts`

- Import maintenance service functions
- Add `GET /maintenance/status` endpoint — returns job status + config (threshold, counter)
- Add `POST /maintenance/run` endpoint — reads graph JSON, guards against empty graph, calls `runMaintenance`
- In the `onComplete` callback (line 260), add `notifyConversationComplete(MCP_SERVER_PATH)` after `runIndexer`

### 5. `packages/chat/src/client/lib/api.ts`

- Add `MaintenanceStatus` interface
- Add `fetchMaintenanceStatus()` function
- Add `triggerMaintenance()` function (POST)

### 6. `packages/chat/src/client/components/graph/GraphToolbar.tsx`

- Import and render `MaintenanceIndicator` between the layout switcher and stats section

## Edge Cases

- **Concurrency with indexer**: Both write to graph.json. Delay periodic maintenance trigger by ~15s after conversation completes to let the indexer finish first.
- **Node moves**: No `move_node` MCP tool exists. Rebalancing must create new nodes + delete old ones. System prompt warns agent about this.
- **Empty graph**: Short-circuit the manual trigger if the graph has only the root node.
- **Large graphs**: Fall back to search-based exploration if graph JSON > 100KB.

## Verification

1. `pnpm build` — ensure new files compile
2. `pnpm dev` — start dev server
3. Click "Maintain" button in graph toolbar with a populated graph
4. Verify the job starts, tool calls appear in the dropdown, and the graph refreshes on completion
5. Have 5+ conversations and verify periodic trigger fires automatically
6. `pnpm typecheck && pnpm lint` — no regressions
