import type { SSEEmitter } from "./cli-chat.js";
import { LineBuffer } from "./line-buffer.js";

/**
 * Encodes SSE events into a Uint8Array suitable for a ReadableStream.
 */
const encoder = new TextEncoder();

export function encodeSSE(event: string, data: string): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
}

/**
 * Creates an SSEEmitter that encodes events into a ReadableStream controller.
 * Returns both the emitter and a close function.
 */
export function createStreamEmitter(
	controller: ReadableStreamDefaultController<Uint8Array>,
): {
	emit: SSEEmitter;
	close: () => void;
} {
	let closed = false;
	return {
		emit(event, data) {
			if (!closed) controller.enqueue(encodeSSE(event, data));
		},
		close() {
			if (!closed) {
				closed = true;
				controller.close();
			}
		},
	};
}

interface ParsedEvent {
	type: string;
	data: string;
}

/**
 * Reads a ReadableStream of SSE-encoded bytes and yields parsed events
 * to the provided callback. Returns when the stream is exhausted.
 */
export async function readSSEStream(
	stream: ReadableStream<Uint8Array>,
	onEvent: (event: ParsedEvent) => void,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const lineBuffer = new LineBuffer();
	let currentEventType = "content";

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;

			for (const line of lineBuffer.push(
				decoder.decode(value, { stream: true }),
			)) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				if (trimmed.startsWith("event: ")) {
					currentEventType = trimmed.slice(7);
					continue;
				}

				if (!trimmed.startsWith("data: ")) continue;
				const data = trimmed.slice(6);
				const type = currentEventType;
				currentEventType = "content";
				onEvent({ type, data });
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * Emits the standard error + done sequence.
 */
export function emitStreamError(
	emit: SSEEmitter,
	message = "Stream failed",
): void {
	emit("error", JSON.stringify({ error: message }));
	emit("done", "[DONE]");
}
