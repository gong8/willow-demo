import { getDisallowedTools } from "./agent-tools.js";
import type { SSEEmitter, ToolCallData } from "./cli-chat.js";
import {
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "./cli-chat.js";

const SEARCH_SYSTEM_PROMPT = `You are a memory search agent. Your job is to navigate a knowledge tree to find information relevant to the user's message.

You navigate one step at a time using walk_graph:
1. Call walk_graph(action: "start") to see the root and its top-level categories.
2. Look at the children and pick the most promising one with walk_graph(action: "down", nodeId: "...").
3. Keep going deeper into branches that look relevant.
4. If a branch isn't useful, backtrack with walk_graph(action: "up", nodeId: "current-node-id").
5. When you've found all relevant information, call walk_graph(action: "done").

RULES:
- Only use walk_graph. You have 3 actions: "down", "up", "done".
- Always start with walk_graph(action: "start").
- For "down": nodeId must be one of the children shown in the current view.
- For "up": nodeId should be your current position's id.
- Be efficient — don't explore branches that are clearly irrelevant.
- Do NOT respond to the user. Only navigate and summarize.

After navigating, output EXACTLY:
<memory_context>
[Summary of relevant facts found, organized by topic. Include node IDs.]
</memory_context>`;

export interface SearchAgentResult {
	contextSummary: string;
	toolCalls: ToolCallData[];
}

interface RunSearchAgentOptions {
	userMessage: string;
	mcpServerPath: string;
	emitSSE: SSEEmitter;
	signal?: AbortSignal;
}

export function runSearchAgent(
	options: RunSearchAgentOptions,
): Promise<SearchAgentResult> {
	const { userMessage, mcpServerPath, emitSSE, signal } = options;

	return new Promise((resolve) => {
		const toolCalls: ToolCallData[] = [];
		let textOutput = "";

		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, mcpServerPath);
		const systemPromptPath = writeSystemPrompt(
			invocationDir,
			SEARCH_SYSTEM_PROMPT,
		);

		const prompt = `Find information relevant to this user message:\n\n${userMessage}`;

		const args = [
			"--print",
			"--output-format",
			"stream-json",
			"--verbose",
			"--include-partial-messages",
			"--model",
			"opus",
			"--dangerously-skip-permissions",
			"--mcp-config",
			mcpConfigPath,
			"--strict-mcp-config",
			"--disallowedTools",
			...getDisallowedTools("search"),
			"--append-system-prompt-file",
			systemPromptPath,
			"--setting-sources",
			"",
			"--no-session-persistence",
			"--max-turns",
			"15",
			prompt,
		];

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args, invocationDir);
		} catch {
			cleanupDir(invocationDir);
			resolve({ contextSummary: "", toolCalls: [] });
			return;
		}

		// Emit tool call events to the parent stream, and capture text for context extraction
		const searchEmitter: SSEEmitter = (event, data) => {
			try {
				const parsed = JSON.parse(data);
				if (event === "tool_call_start") {
					// Prefix toolCallId so the client can identify search-phase tool calls
					const prefixedId = `search__${parsed.toolCallId}`;
					toolCalls.push({
						toolCallId: prefixedId,
						toolName: parsed.toolName as string,
						args: {},
						phase: "search",
					});
					emitSSE(
						"tool_call_start",
						JSON.stringify({
							toolCallId: prefixedId,
							toolName: parsed.toolName,
						}),
					);
				} else if (event === "tool_call_args") {
					const prefixedId = `search__${parsed.toolCallId}`;
					const tc = toolCalls.find((t) => t.toolCallId === prefixedId);
					if (tc) tc.args = parsed.args as Record<string, unknown>;
					emitSSE(
						"tool_call_args",
						JSON.stringify({
							toolCallId: prefixedId,
							toolName: parsed.toolName,
							args: parsed.args,
						}),
					);
				} else if (event === "tool_result") {
					const prefixedId = `search__${parsed.toolCallId}`;
					const tc = toolCalls.find((t) => t.toolCallId === prefixedId);
					if (tc) {
						tc.result = parsed.result as string;
						tc.isError = parsed.isError as boolean;
					}
					emitSSE(
						"tool_result",
						JSON.stringify({
							toolCallId: prefixedId,
							result: parsed.result,
							isError: parsed.isError,
						}),
					);
				} else if (event === "content" && parsed.content) {
					// Capture text output for context extraction (don't forward to UI)
					textOutput += parsed.content;
				}
			} catch {
				// ignore parse errors
			}
		};

		const parser = createStreamParser(searchEmitter);
		proc.stdin?.end();

		if (signal) {
			signal.addEventListener("abort", () => {
				proc.kill("SIGTERM");
			});
		}

		pipeStdout(proc, parser);

		proc.stderr?.on("data", () => {
			// silently discard
		});

		const finish = () => {
			cleanupDir(invocationDir);
			const contextSummary = extractMemoryContext(textOutput);
			resolve({ contextSummary, toolCalls });
		};

		proc.on("close", finish);
		proc.on("error", finish);
	});
}

function extractMemoryContext(text: string): string {
	const match = text.match(/<memory_context>([\s\S]*?)<\/memory_context>/);
	return match ? match[1].trim() : "";
}
