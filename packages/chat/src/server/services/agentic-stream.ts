import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { createLogger } from "../logger.js";
import {
	type CliChatOptions,
	type SSEEmitter,
	runChatAgent,
} from "./cli-chat.js";
import { createEventSocket } from "./event-socket.js";
import { runIndexerAgent } from "./indexer.js";

const log = createLogger("agentic-stream");

interface AgenticStreamOptions {
	/** Options for the chat CLI stream (coordinator config will be injected). */
	chatOptions: CliChatOptions;
	/** The user's latest message text (for the indexer). */
	userMessage: string;
	/** Path to the MCP server entry point. */
	mcpServerPath: string;
	/** Conversation ID for VCS attribution. */
	conversationId?: string;
}

/**
 * Creates a single ReadableStream that wraps an agentic chat session with
 * on-demand memory search and post-chat indexing.
 *
 * Instead of running search -> chat -> indexer sequentially (like combined-stream),
 * the chat agent calls `search_memories` on-demand via the coordinator MCP.
 * Search events arrive on a side-channel (Unix domain socket) and are merged
 * into the SSE stream alongside chat events.
 *
 * Flow:
 *   1. Create event socket for sub-agent event forwarding
 *   2. Run chat agent with coordinator MCP enabled (search happens on-demand)
 *   3. Merge chat stdout events + event socket events into one SSE stream
 *   4. After chat completes, run the indexer phase
 *   5. Auto-commit graph changes with conversation attribution
 *   6. Emit done, clean up socket
 */
export function createAgenticStream(
	options: AgenticStreamOptions,
): ReadableStream<Uint8Array> {
	const { chatOptions, userMessage, mcpServerPath, conversationId } = options;
	const encoder = new TextEncoder();

	return new ReadableStream({
		async start(controller) {
			let closed = false;

			const emit: SSEEmitter = (event, data) => {
				if (closed) return;
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
				);
			};

			const close = () => {
				if (closed) return;
				closed = true;
				controller.close();
			};

			const socket = createEventSocket();
			socket.onEvent(emit);

			try {
				log.info("Stream started", { conversationId });
				let assistantText = "";

				await runChatAgent(
					{
						...chatOptions,
						coordinator: {
							eventSocketPath: socket.socketPath,
							mcpServerPath,
						},
					},
					(event, data) => {
						if (event === "content") {
							try {
								const parsed = JSON.parse(data);
								if (parsed.content) assistantText += parsed.content;
							} catch {
								log.debug("Content parse error");
							}
						}
						if (event !== "done") emit(event, data);
					},
				);
				log.info("Chat phase complete");

				// 3. Indexer phase — update memory with conversation facts
				if (assistantText) {
					log.info("Indexer phase started");
					emit("indexer_phase", JSON.stringify({ status: "start" }));

					await runIndexerAgent({
						userMessage,
						assistantResponse: assistantText,
						mcpServerPath,
						emitSSE: emit,
						signal: chatOptions.signal,
					});
					log.info("Indexer phase complete");

					emit("indexer_phase", JSON.stringify({ status: "end" }));

					// 4. Auto-commit graph changes with conversation attribution
					try {
						const graphPath =
							process.env.WILLOW_GRAPH_PATH ??
							resolve(homedir(), ".willow", "graph.json");
						const store = JsGraphStore.open(graphPath);
						try {
							store.currentBranch();
						} catch {
							try {
								store.vcsInit();
							} catch {
								log.debug("VCS init check");
							}
						}
						// Use commitExternalChanges to diff on-disk graph against
						// last committed state — hasPendingChanges() won't work here
						// because the indexer ran in a separate process.
						store.commitExternalChanges({
							message: "Conversation indexed",
							source: "conversation",
							conversationId: conversationId ?? undefined,
							summary: userMessage.slice(0, 100),
							jobId: undefined,
							toolName: undefined,
						});
						log.info("VCS committed", { conversationId });
					} catch {
						log.warn("VCS commit failed");
					}
				}

				emit("done", "[DONE]");
			} catch {
				log.error("Agentic stream failed");
				if (!closed) {
					emit("error", JSON.stringify({ error: "Agentic stream failed" }));
					emit("done", "[DONE]");
				}
			} finally {
				log.debug("Socket cleanup");
				socket.cleanup();
				close();
			}
		},
	});
}
