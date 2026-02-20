# Simplify-All: Full Codebase Sweep

You are the orchestrator for a massive parallel code-simplification sweep across the entire Willow codebase. You will coordinate **26 execution agents** running simultaneously, followed by **1 verifier** agent.

## Universal rules (apply to EVERY agent)

- Do NOT change functionality — simplify, abstract, and clean up only
- Follow Willow code style: Biome formatter, tabs for indentation, double quotes, semicolons
- Use standard import paths (`.js` extensions are NOT used in this project)
- Do NOT add new npm dependencies or Cargo dependencies
- Keep all existing exports intact
- Do NOT add comments, docstrings, or type annotations to code you didn't change
- Do NOT create README or documentation files
- When extracting helpers, colocate them in the same file or an adjacent local file
- You may create NEW files within your assigned scope but NEVER edit files assigned to other agents
- For Rust files: follow existing patterns (napi-rs v3, thiserror, serde)
- For TypeScript files: follow existing patterns (Hono, React 19, TanStack Query, reagraph, assistant-ui, Zod)

---

## Orchestration

```
1. TeamCreate("simplify-sweep")
2. TaskCreate for all 26 execution tasks
3. Launch ALL 26 exec-* agents simultaneously (mode: bypassPermissions)
4. Wait for all 26 to complete
5. Launch verifier agent (mode: bypassPermissions)
6. Wait for verifier to complete
7. TeamDelete
8. Report final status to user
```

---

## Phase 1: EXECUTION — 26 agents in parallel

Every agent below uses `subagent_type: code-simplifier:code-simplifier` and `mode: bypassPermissions`.

---

### Agent 1 — `exec-rust-repository`

**Files:**
- `crates/willow-core/src/vcs/repository.rs` (974 lines)

**Task:** Simplify the VCS repository module — the largest file in the project. Extract repeated patterns, simplify control flow, reduce nesting. Look for duplicated commit/branch logic that can be consolidated.

---

### Agent 2 — `exec-rust-store`

**Files:**
- `crates/willow-core/src/store.rs` (830 lines)

**Task:** Simplify the graph store. Look for repeated node/link traversal patterns, duplicated validation, and complex match arms that can be collapsed.

---

### Agent 3 — `exec-rust-merge`

**Files:**
- `crates/willow-core/src/vcs/merge.rs` (637 lines)

**Task:** Simplify the VCS merge logic. Look for repeated conflict-detection patterns, duplicated tree-walking code, and overly nested conditionals.

---

### Agent 4 — `exec-rust-napi`

**Files:**
- `crates/willow-core/src/napi_exports.rs` (616 lines)

**Task:** Simplify the NAPI export bindings. Look for repeated boilerplate in function signatures, duplicated error conversion patterns, and serialization logic that can be extracted into helpers.

---

### Agent 5 — `exec-rust-vcs-infra`

**Files:**
- `crates/willow-core/src/vcs/object_store.rs` (499 lines)
- `crates/willow-core/src/vcs/diff.rs` (274 lines)
- `crates/willow-core/src/vcs/types.rs` (213 lines)
- `crates/willow-core/src/vcs/mod.rs` (5 lines)

**Task:** Simplify VCS infrastructure files. Look for duplicated hash/serialization patterns in object_store, repeated tree-comparison logic in diff, and type definitions in types.rs that could use derive macros more effectively.

---

### Agent 6 — `exec-rust-core-lib`

**Files:**
- `crates/willow-core/src/search.rs` (260 lines)
- `crates/willow-core/src/model.rs` (92 lines)
- `crates/willow-core/src/error.rs` (72 lines)
- `crates/willow-core/src/storage.rs` (51 lines)
- `crates/willow-core/src/lib.rs` (26 lines)
- `crates/willow-core/build.rs` (5 lines)

**Task:** Simplify core library files. Focus on search.rs — look for duplicated scoring/matching logic and repeated iterator chains. Tighten error.rs variants if any are unused.

---

### Agent 7 — `exec-cli-chat`

**Files:**
- `packages/chat/src/server/services/cli-chat.ts` (891 lines)

**Task:** Simplify the CLI chat service — the largest TypeScript file. Aggressively decompose:
1. Extract message-parsing logic into helper functions
2. Consolidate duplicated stream-handling patterns
3. Simplify deeply nested async control flow
4. Extract repeated error-handling patterns

---

### Agent 8 — `exec-stream-services`

**Files:**
- `packages/chat/src/server/services/stream-manager.ts` (383 lines)
- `packages/chat/src/server/services/agentic-stream.ts` (169 lines)
- `packages/chat/src/server/services/event-socket.ts` (74 lines)
- `packages/chat/src/server/services/line-buffer.ts` (13 lines)

**Task:** Simplify streaming infrastructure. Look for duplicated event-handling patterns between stream-manager and agentic-stream, repeated SSE formatting, and shared connection-management logic that can be consolidated.

---

### Agent 9 — `exec-maintenance-crawl`

**Files:**
- `packages/chat/src/server/services/maintenance/crawler.ts` (319 lines)
- `packages/chat/src/server/services/maintenance/index.ts` (184 lines)

**Task:** Simplify the maintenance crawler and orchestrator. Look for repeated graph-traversal patterns, duplicated scheduling logic, and complex conditionals in the crawl decision logic.

---

### Agent 10 — `exec-maintenance-pipeline`

**Files:**
- `packages/chat/src/server/services/maintenance/pipeline.ts` (221 lines)
- `packages/chat/src/server/services/maintenance/pre-scan.ts` (165 lines)
- `packages/chat/src/server/services/maintenance/types.ts` (91 lines)

**Task:** Simplify the maintenance pipeline and pre-scan. Look for duplicated node-processing patterns, repeated filtering logic, and type definitions that could be simplified with utility types.

---

### Agent 11 — `exec-maintenance-resolve`

**Files:**
- `packages/chat/src/server/services/maintenance/resolver.ts` (160 lines)
- `packages/chat/src/server/services/maintenance/resolver-prompt.ts` (150 lines)

**Task:** Simplify the maintenance resolver. Look for duplicated prompt-construction patterns and repeated LLM-call boilerplate.

---

### Agent 12 — `exec-server-routes`

**Files:**
- `packages/chat/src/server/routes/chat.ts` (304 lines)
- `packages/chat/src/server/routes/graph.ts` (191 lines)
- `packages/chat/src/server/routes/chat-attachments.ts` (113 lines)

**Task:** Simplify server route handlers. Look for duplicated request-validation patterns, repeated error-response formatting, and shared middleware logic that can be extracted.

---

### Agent 13 — `exec-server-services`

**Files:**
- `packages/chat/src/server/services/search-agent.ts` (202 lines)
- `packages/chat/src/server/services/agent-tools.ts` (94 lines)
- `packages/chat/src/server/services/indexer.ts` (181 lines)
- `packages/chat/src/server/index.ts` (31 lines)
- `packages/chat/src/server/logger.ts` (66 lines)

**Task:** Simplify agent/search services and server config. Look for duplicated tool-registration patterns in agent-tools, repeated search-result formatting in search-agent, and shared indexing logic in indexer.

---

### Agent 14 — `exec-subgraph-extractors`

**Files:**
- `packages/chat/src/client/components/chat/graph-viz/subgraph-extractors.ts` (711 lines)

**Task:** Simplify the subgraph extraction module — the largest client-side file. Look for:
1. Duplicated tree-walking/filtering patterns across extractor functions
2. Repeated node-collection logic that can be unified
3. Complex nested conditionals that can be flattened
4. Shared extraction patterns that can be abstracted into a generic extractor

---

### Agent 15 — `exec-chat-adapter`

**Files:**
- `packages/chat/src/client/lib/chat-adapter.ts` (461 lines)

**Task:** Simplify the assistant-ui chat adapter. Look for duplicated message-transformation logic, repeated runtime configuration, and complex stream-handling that can be streamlined.

---

### Agent 16 — `exec-history-panels`

**Files:**
- `packages/chat/src/client/components/history/CommitDetailPanel.tsx` (294 lines)
- `packages/chat/src/client/components/history/CompareView.tsx` (252 lines)
- `packages/chat/src/client/components/history/SnapshotGraphPreview.tsx` (108 lines)

**Task:** Simplify history panel components. Look for duplicated diff-rendering logic between CommitDetailPanel and CompareView, repeated node/link display patterns, and shared styling/layout that can be extracted.

---

### Agent 17 — `exec-history-nav`

**Files:**
- `packages/chat/src/client/components/history/HistoryView.tsx` (158 lines)
- `packages/chat/src/client/components/history/CommitLog.tsx` (128 lines)
- `packages/chat/src/client/components/history/HistoryToolbar.tsx` (73 lines)

**Task:** Simplify history navigation components. Look for duplicated commit-selection logic, repeated list-rendering patterns, and shared toolbar state management.

---

### Agent 18 — `exec-chat-core`

**Files:**
- `packages/chat/src/client/components/chat/ChatComposer.tsx` (164 lines)
- `packages/chat/src/client/components/chat/ChatThread.tsx` (132 lines)
- `packages/chat/src/client/components/chat/AssistantMessage.tsx` (95 lines)
- `packages/chat/src/client/components/chat/UserMessage.tsx` (121 lines)
- `packages/chat/src/client/components/chat/EditComposer.tsx` (28 lines)

**Task:** Simplify core chat components. Look for duplicated message-rendering patterns between AssistantMessage and UserMessage, repeated styling logic, and shared composition patterns between ChatComposer and EditComposer.

---

### Agent 19 — `exec-chat-widgets`

**Files:**
- `packages/chat/src/client/components/chat/ReconnectStreamView.tsx` (193 lines)
- `packages/chat/src/client/components/chat/WillowToolCallDisplay.tsx` (181 lines)
- `packages/chat/src/client/components/chat/IndexerIndicator.tsx` (118 lines)
- `packages/chat/src/client/components/chat/SearchIndicator.tsx` (56 lines)
- `packages/chat/src/client/components/chat/ToolCallDisplay.tsx` (76 lines)
- `packages/chat/src/client/components/chat/ReasoningDisplay.tsx` (35 lines)

**Task:** Simplify chat widget components. Look for duplicated status-indicator patterns between IndexerIndicator and SearchIndicator, repeated tool-call rendering logic between ToolCallDisplay and WillowToolCallDisplay, and shared animation/transition patterns.

---

### Agent 20 — `exec-graph-page`

**Files:**
- `packages/chat/src/client/components/graph/GraphView.tsx` (147 lines)
- `packages/chat/src/client/components/graph/MaintenanceIndicator.tsx` (213 lines)
- `packages/chat/src/client/components/graph/NodeDetailPanel.tsx` (153 lines)
- `packages/chat/src/client/components/graph/GraphFilters.tsx` (50 lines)
- `packages/chat/src/client/components/graph/GraphToolbar.tsx` (63 lines)

**Task:** Simplify graph page components. Look for duplicated filter/toolbar state management, repeated reagraph configuration patterns, and shared node-display logic between GraphView and NodeDetailPanel.

---

### Agent 21 — `exec-graph-viz`

**Files:**
- `packages/chat/src/client/components/chat/graph-viz/MiniGraphCanvas.tsx` (36 lines)
- `packages/chat/src/client/components/chat/graph-viz/SearchGraphViz.tsx` (90 lines)
- `packages/chat/src/client/components/chat/graph-viz/WillowToolViz.tsx` (122 lines)
- `packages/chat/src/client/components/chat/graph-viz/useCumulativeSearchGraph.ts` (190 lines)
- `packages/chat/src/client/components/chat/graph-viz/useGraphAnimation.ts` (53 lines)
- `packages/chat/src/client/components/chat/graph-viz/types.ts` (22 lines)

**Task:** Simplify graph visualization components. Look for duplicated reagraph canvas setup between MiniGraphCanvas, SearchGraphViz, and WillowToolViz. Extract shared graph-rendering configuration. Simplify useCumulativeSearchGraph hook logic.

---

### Agent 22 — `exec-client-lib`

**Files:**
- `packages/chat/src/client/lib/api.ts` (191 lines)
- `packages/chat/src/client/lib/graph-transform.ts` (135 lines)
- `packages/chat/src/client/lib/graph-types.ts` (89 lines)

**Task:** Simplify client library files. Look for duplicated fetch/error-handling patterns in api.ts, repeated graph-data transformation logic in graph-transform, and type definitions in graph-types that could be simplified.

---

### Agent 23 — `exec-client-shell`

**Files:**
- `packages/chat/src/client/App.tsx` (93 lines)
- `packages/chat/src/client/components/ConversationSidebar.tsx` (150 lines)
- `packages/chat/src/client/main.tsx` (10 lines)
- `packages/chat/src/client/hooks/useChatHistory.ts` (180 lines)
- `packages/chat/src/client/hooks/useMaintenanceStatus.ts` (33 lines)
- `packages/chat/src/client/hooks/useStreamReconnect.ts` (185 lines)

**Task:** Simplify the app shell and custom hooks. Look for duplicated TanStack Query patterns across hooks, repeated polling/reconnection logic between useMaintenanceStatus and useStreamReconnect, and shared state management in ConversationSidebar.

---

### Agent 24 — `exec-mcp-server`

**Files:**
- `packages/mcp-server/src/index.ts` (280 lines)
- `packages/mcp-server/src/logger.ts` (70 lines)

**Task:** Simplify the MCP server. Look for duplicated tool-registration boilerplate, repeated Zod-validation patterns, and shared request/response formatting that can be extracted into a helper.

---

### Agent 25 — `exec-shared`

**Files:**
- `packages/shared/src/schemas.ts` (123 lines)
- `packages/shared/src/index.ts` (9 lines)

**Task:** Simplify the shared package. Focus on schemas.ts — look for duplicated Zod patterns, repeated field definitions, and schema compositions that can be DRY'd up.

**IMPORTANT:** Keep all existing exports intact — every other package depends on shared.

---

### Agent 26 — `exec-tests`

**Test files (18 files):**

Server tests:
- `packages/chat/src/server/__tests__/routes.test.ts` (85 lines)
- `packages/chat/src/server/services/__tests__/agentic-stream.test.ts` (61 lines)
- `packages/chat/src/server/services/__tests__/cli-chat.test.ts` (141 lines)
- `packages/chat/src/server/services/__tests__/event-socket.test.ts` (76 lines)
- `packages/chat/src/server/services/__tests__/indexer.test.ts` (71 lines)
- `packages/chat/src/server/services/__tests__/line-buffer.test.ts` (32 lines)
- `packages/chat/src/server/services/__tests__/stream-manager.test.ts` (142 lines)
- `packages/chat/src/server/services/maintenance/__tests__/crawler.test.ts` (139 lines)
- `packages/chat/src/server/services/maintenance/__tests__/index.test.ts` (72 lines)
- `packages/chat/src/server/services/maintenance/__tests__/pipeline.test.ts` (148 lines)
- `packages/chat/src/server/services/maintenance/__tests__/pre-scan.test.ts` (235 lines)

Client tests:
- `packages/chat/src/client/components/__tests__/ConversationSidebar.test.tsx` (43 lines)
- `packages/chat/src/client/components/chat/__tests__/AssistantMessage.test.tsx` (55 lines)
- `packages/chat/src/client/components/chat/__tests__/ChatComposer.test.tsx` (47 lines)
- `packages/chat/src/client/components/chat/__tests__/ChatThread.test.tsx` (55 lines)
- `packages/chat/src/client/components/chat/__tests__/UserMessage.test.tsx` (36 lines)
- `packages/chat/src/client/hooks/__tests__/useChatHistory.test.ts` (47 lines)

Package tests:
- `packages/mcp-server/src/__tests__/index.test.ts` (149 lines)
- `packages/shared/src/__tests__/schemas.test.ts` (104 lines)

**Task:** Simplify ALL test files. Look for:
1. Duplicated setup/teardown patterns — consolidate into shared helpers
2. Repeated mock construction — extract mock factories
3. Duplicated assertion patterns — extract custom matchers or assertion helpers
4. Repeated `describe`/`it` structures that test similar patterns
5. Boilerplate that can be reduced with `beforeEach`/`afterEach`

Do NOT change what is being tested — only simplify how tests are written.

---

## Phase 2: VERIFICATION — 1 agent, sequential

### Agent 27 — `verifier`

**subagent_type:** `code-simplifier:code-simplifier`
**mode:** `bypassPermissions`

After ALL 26 execution agents have completed, run verification:

1. `pnpm lint:fix` — auto-fix Biome style issues
2. `pnpm build` — build all packages, confirm no TypeScript/Rust errors
3. `pnpm test` — run full test suite, confirm all tests pass

If any step fails:
- Read the error output carefully
- Fix the issue (missing imports, broken references, type errors, etc.)
- Re-run the failing command
- Repeat until all 3 commands pass cleanly

The verifier has full access to edit ANY file to fix cross-cutting issues like:
- Duplicate helper names created by different agents
- Missing imports from extracted modules
- Type errors from interface changes
- Broken re-exports

---

## Summary

| Metric | Value |
|--------|-------|
| Total agents | 27 |
| Peak parallelism | 26 |
| Source files covered | 96 |
| Total lines of code | ~16,445 |
| Languages | Rust, TypeScript, TSX |
