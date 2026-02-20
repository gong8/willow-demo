import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { createLogger } from "../logger";
import { type CliChatOptions, type SSEEmitter, runChatAgent } from "./cli-chat";
import { createEventSocket } from "./event-socket";
import { runIndexerAgent } from "./indexer";
import { createStreamEmitter, emitStreamError } from "./sse-codec";

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

async function runAgenticPipeline(
	emit: SSEEmitter,
	options: AgenticStreamOptions,
): Promise<void> {
	const { chatOptions, userMessage, mcpServerPath, conversationId } = options;

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

		if (assistantText) {
			await runIndexerPhase(emit, {
				userMessage,
				mcpServerPath,
				assistantText,
				conversationId,
				signal: chatOptions.signal,
			});
		}

		emit("done", "[DONE]");
	} catch {
		log.error("Agentic stream failed");
		emitStreamError(emit, "Agentic stream failed");
	} finally {
		log.debug("Socket cleanup");
		socket.cleanup();
	}
}

interface IndexerPhaseOptions {
	userMessage: string;
	mcpServerPath: string;
	assistantText: string;
	conversationId?: string;
	signal?: AbortSignal;
}

async function runIndexerPhase(
	emit: SSEEmitter,
	options: IndexerPhaseOptions,
): Promise<void> {
	log.info("Indexer phase started");
	emit("indexer_phase", JSON.stringify({ status: "start" }));

	await runIndexerAgent({
		userMessage: options.userMessage,
		assistantResponse: options.assistantText,
		mcpServerPath: options.mcpServerPath,
		emitSSE: emit,
		signal: options.signal,
	});
	log.info("Indexer phase complete");
	emit("indexer_phase", JSON.stringify({ status: "end" }));

	commitGraphChanges(options.conversationId, options.userMessage);
}

function commitGraphChanges(
	conversationId: string | undefined,
	userMessage: string,
): void {
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

/**
 * Creates a single ReadableStream that wraps an agentic chat session with
 * on-demand memory search and post-chat indexing.
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
	return new ReadableStream({
		async start(controller) {
			const { emit, close } = createStreamEmitter(controller);
			try {
				await runAgenticPipeline(emit, options);
			} finally {
				close();
			}
		},
	});
}
