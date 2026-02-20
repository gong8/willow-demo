import { createLogger } from "../logger.js";
import { getDisallowedTools } from "./agent-tools.js";
import type { SSEEmitter, ToolCallData } from "./cli-chat.js";
import {
	LLM_MODEL,
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	getCliModel,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "./cli-chat.js";

const log = createLogger("resource-indexer");

const MAX_TEXT_LENGTH = 50_000;

const RESOURCE_INDEXER_SYSTEM_PROMPT = `You are a background knowledge-graph indexer. Your ONLY job is to analyze a document and extract important facts into the user's knowledge graph.

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
   - You MUST use one of these relations (the schema enforces this — non-canonical relations will be rejected):
     * related_to — general connection (default if unsure)
     * contradicts — conflicting information
     * caused_by — A was caused by B
     * leads_to — A leads to / results in B
     * depends_on — A requires B
     * similar_to — A and B are alike
     * part_of — A is a component of B
     * example_of — A is an instance of B
     * derived_from — A originates from B
   - Use bidirectional: true for symmetric relationships like related_to, similar_to.
   - Do NOT set confidence on links — that is handled by maintenance.
4. Use delete_node to remove information that is clearly outdated or wrong.
5. If there is nothing new to store, do nothing.
6. Keep facts atomic — one fact per node.
7. IMPORTANT: On EVERY node you create, set metadata: { source_type: "resource", source_id: "<resource-id>" } so we can trace facts back to the source document.
8. Use meaningful metadata (confidence: "high"/"medium" in addition to source_type and source_id).

Do NOT respond to the user. Do NOT produce any conversational text. Only make tool calls.`;

export interface RunResourceIndexerOptions {
	resourceId: string;
	resourceName: string;
	extractedText: string;
	indexContext?: string;
	mcpServerPath: string;
	emitSSE: SSEEmitter;
	signal?: AbortSignal;
}

export function runResourceIndexer(
	options: RunResourceIndexerOptions,
): Promise<void> {
	const {
		resourceId,
		resourceName,
		extractedText,
		indexContext,
		mcpServerPath,
		emitSSE,
		signal,
	} = options;

	return new Promise((resolve, reject) => {
		log.info("Resource indexer started", { resourceId, resourceName });
		const toolCalls: ToolCallData[] = [];

		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, mcpServerPath);
		const systemPromptPath = writeSystemPrompt(
			invocationDir,
			RESOURCE_INDEXER_SYSTEM_PROMPT,
		);

		// Strip null bytes as a safety net (PDFs can produce them)
		const cleanText = extractedText.replaceAll("\0", "");
		const truncatedText =
			cleanText.length > MAX_TEXT_LENGTH
				? `${cleanText.slice(0, MAX_TEXT_LENGTH)}\n\n[... truncated — ${cleanText.length - MAX_TEXT_LENGTH} more characters]`
				: cleanText;

		const contextLine = indexContext ? `\nUser context: ${indexContext}` : "";

		const prompt = `<document resource_id="${resourceId}" name="${resourceName}">${contextLine}\n${truncatedText}\n</document>\nAnalyze the above document and extract important facts into the knowledge graph. Remember to set metadata.source_type = "resource" and metadata.source_id = "${resourceId}" on every node you create.`;

		const args = [
			"--print",
			"--output-format",
			"stream-json",
			"--verbose",
			"--include-partial-messages",
			"--model",
			getCliModel(LLM_MODEL),
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
			"15",
			prompt,
		];

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args, invocationDir);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("CLI spawn failed", { error: msg });
			cleanupDir(invocationDir);
			reject(new Error(`CLI spawn failed: ${msg}`));
			return;
		}

		// Emit tool call events to the parent stream with resource_indexer__ prefix
		const indexerEmitter: SSEEmitter = (event, data) => {
			try {
				const parsed = JSON.parse(data);
				if (event === "tool_call_start") {
					const prefixedId = `resource_indexer__${parsed.toolCallId}`;
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
					const prefixedId = `resource_indexer__${parsed.toolCallId}`;
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
					const prefixedId = `resource_indexer__${parsed.toolCallId}`;
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
			log.info("Resource indexer complete", { resourceId });
			resolve();
		};

		proc.on("close", finish);
		proc.on("error", (err) => {
			cleanupDir(invocationDir);
			log.error("Resource indexer process error", {
				resourceId,
				error: err.message,
			});
			reject(new Error(`Resource indexer failed: ${err.message}`));
		});
	});
}
