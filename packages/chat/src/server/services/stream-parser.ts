import { createLogger } from "../logger.js";

const log = createLogger("stream-parser");

export type BlockType = "text" | "tool_use" | "thinking";
export type SSEEmitter = (event: string, data: string) => void;

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	phase?: "search" | "chat" | "indexer";
}

function extractToolResultText(
	blockContent: string | Array<Record<string, unknown>> | undefined,
): string {
	if (typeof blockContent === "string") return blockContent;
	if (Array.isArray(blockContent)) {
		return blockContent.map((c) => (c.text as string) || "").join("");
	}
	return "";
}

function emitUserToolResults(
	msg: Record<string, unknown>,
	emitSSE: SSEEmitter,
): void {
	const message = msg.message as Record<string, unknown> | undefined;
	const content =
		message?.role === "user"
			? (message.content as Array<Record<string, unknown>> | undefined)
			: undefined;
	if (!content) return;
	for (const block of content) {
		if (block.type !== "tool_result") continue;
		emitSSE(
			"tool_result",
			JSON.stringify({
				toolCallId: block.tool_use_id as string,
				result: extractToolResultText(
					block.content as string | Array<Record<string, unknown>> | undefined,
				),
				isError: block.is_error === true,
			}),
		);
	}
}

export function createStreamParser(emitSSE: SSEEmitter) {
	const blockTypes = new Map<number, BlockType>();
	const toolCalls = new Map<
		number,
		{ id: string; name: string; argsJson: string }
	>();

	function handleBlockStart(
		index: number,
		block: Record<string, unknown>,
	): void {
		const blockType = block.type as string;
		if (blockType === "tool_use") {
			blockTypes.set(index, "tool_use");
			const toolCallId = (block.id as string) || `tool_${index}`;
			const toolName = (block.name as string) || "unknown";
			toolCalls.set(index, { id: toolCallId, name: toolName, argsJson: "" });
			emitSSE("tool_call_start", JSON.stringify({ toolCallId, toolName }));
		} else if (blockType === "thinking") {
			blockTypes.set(index, "thinking");
			emitSSE("thinking_start", JSON.stringify({}));
		} else {
			blockTypes.set(index, "text");
		}
	}

	function handleBlockDelta(
		index: number,
		delta: Record<string, unknown>,
	): void {
		const deltaType = delta.type as string;
		const blockType = blockTypes.get(index);

		if (deltaType === "text_delta" && delta.text && blockType === "text") {
			emitSSE("content", JSON.stringify({ content: delta.text as string }));
		} else if (
			deltaType === "input_json_delta" &&
			delta.partial_json !== undefined
		) {
			const tc = toolCalls.get(index);
			if (tc) tc.argsJson += delta.partial_json as string;
		} else if (deltaType === "thinking_delta" && delta.thinking) {
			emitSSE(
				"thinking_delta",
				JSON.stringify({ text: delta.thinking as string }),
			);
		}
	}

	function handleBlockStop(index: number): void {
		if (blockTypes.get(index) !== "tool_use") return;
		const tc = toolCalls.get(index);
		if (!tc) return;
		let args: Record<string, unknown> = {};
		try {
			args = tc.argsJson ? JSON.parse(tc.argsJson) : {};
		} catch {
			log.debug("Tool call args parse failed");
		}
		emitSSE(
			"tool_call_args",
			JSON.stringify({ toolCallId: tc.id, toolName: tc.name, args }),
		);
	}

	function processEvent(event: Record<string, unknown>): void {
		const index = event.index as number;
		switch (event.type as string) {
			case "content_block_start":
				handleBlockStart(index, event.content_block as Record<string, unknown>);
				break;
			case "content_block_delta":
				handleBlockDelta(index, event.delta as Record<string, unknown>);
				break;
			case "content_block_stop":
				handleBlockStop(index);
				break;
			case "message_start":
				emitUserToolResults(event, emitSSE);
				break;
		}
	}

	return {
		process(msg: Record<string, unknown>): void {
			if (msg.type === "user") {
				emitUserToolResults(msg, emitSSE);
				return;
			}
			if (msg.type !== "stream_event") return;
			const event = msg.event as Record<string, unknown> | undefined;
			if (event) processEvent(event);
		},
	};
}
