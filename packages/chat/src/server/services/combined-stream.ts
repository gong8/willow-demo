import type { SSEEmitter } from "./cli-chat.js";
import { type CliChatOptions, runChatAgent } from "./cli-chat.js";
import { runIndexerAgent } from "./indexer.js";
import { runSearchAgent } from "./search-agent.js";

interface CombinedStreamOptions {
	/** Options for the chat CLI stream (system prompt will be modified with search context). */
	chatOptions: CliChatOptions;
	/** The user's latest message text (for the search agent and indexer). */
	userMessage: string;
	/** Path to the MCP server entry point. */
	mcpServerPath: string;
}

/**
 * Creates a single ReadableStream that wraps the search, chat, and indexer phases.
 *
 * Phase 1: search_phase:start → runSearchAgent(emit) → search_phase:end
 * Phase 2: runChatAgent(chatEmitter) — intercepts content to accumulate assistantText
 * Phase 3: indexer_phase:start → runIndexerAgent(emit) → indexer_phase:end
 * → done
 */
export function createCombinedStream(
	options: CombinedStreamOptions,
): ReadableStream<Uint8Array> {
	const { chatOptions, userMessage, mcpServerPath } = options;
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

			try {
				// Phase 1: Search
				emit("search_phase", JSON.stringify({ status: "start" }));

				const searchResult = await runSearchAgent({
					userMessage,
					mcpServerPath,
					emitSSE: emit,
					signal: chatOptions.signal,
				});

				emit("search_phase", JSON.stringify({ status: "end" }));

				// Phase 2: Chat — inject search context, capture assistant text
				const modifiedSystemPrompt = searchResult.contextSummary
					? `${chatOptions.systemPrompt}\n\n<retrieved_memories>\n${searchResult.contextSummary}\n</retrieved_memories>`
					: chatOptions.systemPrompt;

				let assistantText = "";

				const chatEmitter: SSEEmitter = (event, data) => {
					// Intercept content events to accumulate assistant text
					if (event === "content") {
						try {
							const parsed = JSON.parse(data);
							if (parsed.content) {
								assistantText += parsed.content as string;
							}
						} catch {
							// ignore
						}
					}
					// Forward all events (but not "done" — we control lifecycle)
					if (event !== "done") {
						emit(event, data);
					}
				};

				await runChatAgent(
					{
						...chatOptions,
						systemPrompt: modifiedSystemPrompt,
					},
					chatEmitter,
				);

				// Phase 3: Indexer — update memory with conversation facts
				if (assistantText) {
					emit("indexer_phase", JSON.stringify({ status: "start" }));

					await runIndexerAgent({
						userMessage,
						assistantResponse: assistantText,
						mcpServerPath,
						emitSSE: emit,
						signal: chatOptions.signal,
					});

					emit("indexer_phase", JSON.stringify({ status: "end" }));
				}

				emit("done", "[DONE]");
			} catch {
				if (!closed) {
					emit("error", JSON.stringify({ error: "Combined stream failed" }));
					emit("done", "[DONE]");
				}
			} finally {
				close();
			}
		},
	});
}
