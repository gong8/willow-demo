import { getDisallowedTools } from "./agent-tools.js";
import type { SSEEmitter, ToolCallData } from "./cli-chat.js";
import { createLogger } from "../logger.js";
import {
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "./cli-chat.js";

const log = createLogger("indexer");

const INDEXER_SYSTEM_PROMPT = `You are a background knowledge-graph indexer. Your ONLY job is to analyze a conversation and update the user's knowledge graph with any new facts.

NODE TYPES (use the most specific type that fits):
- "category": Top-level grouping (Education, Work, Hobbies). Direct children of root.
- "collection": Sub-grouping within a category or entity (Programming Languages, Architecture, Contact Info).
- "entity": A named thing — person, organization, project, place, tool (Imperial College, Python, Willow).
- "attribute": A fact or property about something (BEng Maths & CS, Location: London).
- "event": A time-bound occurrence (IBM Z Datathon Oct 2024, Started university Sep 2024).
- "detail": Additional depth or elaboration on any node. Use when a fact needs further explanation or nuance.

BUILD DEEP HIERARCHIES: root → category → entity/collection → attribute/event → detail.
Any node can have children. Use "detail" to add depth anywhere — entities within entities, details within details. Don't flatten everything under category.

RULES:
1. First, use search_nodes to check what already exists — never create duplicates.
2. Use update_node if a fact updates or corrects something already stored. Provide a reason.
3. Use add_link to connect related facts across different categories.
4. Use delete_node to remove information that is clearly outdated or wrong.
5. If there is nothing new to store, do nothing.
6. Keep facts atomic — one fact per node.
7. Use meaningful metadata (source: "conversation", confidence: "high"/"medium").

Do NOT respond to the user. Do NOT produce any conversational text. Only make tool calls.`;

export interface RunIndexerAgentOptions {
	userMessage: string;
	assistantResponse: string;
	mcpServerPath: string;
	emitSSE: SSEEmitter;
	signal?: AbortSignal;
}

export function runIndexerAgent(
	options: RunIndexerAgentOptions,
): Promise<void> {
	const { userMessage, assistantResponse, mcpServerPath, emitSSE, signal } =
		options;

	return new Promise((resolve) => {
		log.info("Indexer started");
		const toolCalls: ToolCallData[] = [];

		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, mcpServerPath);
		const systemPromptPath = writeSystemPrompt(
			invocationDir,
			INDEXER_SYSTEM_PROMPT,
		);

		const prompt = `<conversation>\nUser: ${userMessage}\nAssistant: ${assistantResponse}\n</conversation>\nAnalyze the above and update the knowledge graph with any new facts about the user.`;

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
			...getDisallowedTools("indexer"),
			"--append-system-prompt-file",
			systemPromptPath,
			"--setting-sources",
			"",
			"--no-session-persistence",
			"--max-turns",
			"10",
			prompt,
		];

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args, invocationDir);
		} catch {
			log.error("CLI spawn failed");
			cleanupDir(invocationDir);
			resolve();
			return;
		}

		// Emit tool call events to the parent stream with indexer__ prefix
		const indexerEmitter: SSEEmitter = (event, data) => {
			try {
				const parsed = JSON.parse(data);
				if (event === "tool_call_start") {
					const prefixedId = `indexer__${parsed.toolCallId}`;
					toolCalls.push({
						toolCallId: prefixedId,
						toolName: parsed.toolName as string,
						args: {},
						phase: "indexer",
					});
					emitSSE(
						"tool_call_start",
						JSON.stringify({
							toolCallId: prefixedId,
							toolName: parsed.toolName,
						}),
					);
				} else if (event === "tool_call_args") {
					const prefixedId = `indexer__${parsed.toolCallId}`;
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
					const prefixedId = `indexer__${parsed.toolCallId}`;
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
				}
				// Content from indexer is silently discarded (no text output needed)
			} catch {
				log.debug("Emitter parse error");
			}
		};

		const parser = createStreamParser(indexerEmitter);
		proc.stdin?.end();

		if (signal) {
			signal.addEventListener("abort", () => {
				proc.kill("SIGTERM");
			});
		}

		pipeStdout(proc, parser);

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString().trim();
			if (text) log.debug("stderr", { text: text.slice(0, 1000) });
		});

		const finish = () => {
			cleanupDir(invocationDir);
			log.info("Indexer complete");
			resolve();
		};

		proc.on("close", finish);
		proc.on("error", finish);
	});
}
