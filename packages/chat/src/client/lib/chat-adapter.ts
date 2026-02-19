import type {
	AttachmentAdapter,
	ChatModelAdapter,
	ChatModelRunResult,
} from "@assistant-ui/react";

const BASE_URL = "/api";

export const chatAttachmentAdapter: AttachmentAdapter = {
	accept: "image/jpeg,image/png,image/gif,image/webp",

	async add({ file }) {
		const pending = (id: string, name: string, contentType: string) => ({
			id,
			type: "image" as const,
			name,
			contentType,
			file,
			status: {
				type: "requires-action" as const,
				reason: "composer-send" as const,
			},
		});

		const restoreMatch = file.name.match(/^__restore__([^_]+)__(.+)$/);
		if (restoreMatch) {
			return pending(restoreMatch[1], restoreMatch[2], file.type);
		}

		const formData = new FormData();
		formData.append("file", file);
		const res = await fetch(`${BASE_URL}/chat/attachments`, {
			method: "POST",
			body: formData,
		});
		if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

		const { id, filename, contentType } = (await res.json()) as {
			id: string;
			url: string;
			filename: string;
			contentType: string;
		};
		return pending(id, filename, contentType);
	},

	async send(attachment) {
		return {
			...attachment,
			status: { type: "complete" as const },
			content: [
				{
					type: "image" as const,
					image: `${BASE_URL}/chat/attachments/${attachment.id}`,
				},
			],
		};
	},

	async remove(attachment) {
		await fetch(`${BASE_URL}/chat/attachments/${attachment.id}`, {
			method: "DELETE",
		}).catch(() => {});
	},
};

interface ToolCallState {
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

export interface SearchResultsPart {
	type: "search-results";
	searchStatus: "searching" | "done";
	toolCalls: Array<{
		toolCallId: string;
		toolName: string;
		args: Record<string, unknown>;
		result?: string;
		isError?: boolean;
	}>;
}

export interface IndexerResultsPart {
	type: "indexer-results";
	indexerStatus: "running" | "done";
	toolCalls: Array<{
		toolCallId: string;
		toolName: string;
		args: Record<string, unknown>;
		result?: string;
		isError?: boolean;
	}>;
}

type ContentPart =
	| { type: "reasoning"; text: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			argsText: string;
			result?: unknown;
			isError?: boolean;
	  }
	| { type: "text"; text: string }
	| SearchResultsPart
	| IndexerResultsPart;

interface SseState {
	textContent: string;
	thinkingText: string;
	toolCalls: Map<string, ToolCallState>;
	searchPhase: "idle" | "searching" | "done";
	indexerPhase: "idle" | "running" | "done";
}

function parseTextToolCalls(text: string) {
	const calls = [
		...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g),
	].flatMap((m) => {
		try {
			const parsed = JSON.parse(m[1]);
			return [
				{ toolName: parsed.name || "unknown", args: parsed.arguments || {} },
			];
		} catch {
			return [];
		}
	});

	const results = [
		...text.matchAll(/<tool_result>\s*([\s\S]*?)\s*<\/tool_result>/g),
	].map((m) => m[1].trim());

	const parsedCalls = calls.map((call, i) => ({
		id: `text_tc_${i}`,
		toolName: call.toolName,
		args: call.args,
		result: results[i],
	}));

	const cleanText = text
		.replace(/<tool_(?:call|result)>[\s\S]*?<\/tool_(?:call|result)>/g, "")
		.replace(/<tool_(?:call|result)[\s\S]*$/, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return { cleanText, parsedCalls };
}

function buildContentParts(state: SseState): ContentPart[] {
	const { cleanText, parsedCalls } = parseTextToolCalls(state.textContent);
	const parts: ContentPart[] = [];

	if (state.thinkingText)
		parts.push({ type: "reasoning", text: state.thinkingText });

	// Separate tool calls by ID prefix
	const searchCalls: SearchResultsPart["toolCalls"] = [];
	const indexerCalls: IndexerResultsPart["toolCalls"] = [];

	for (const tc of state.toolCalls.values()) {
		if (tc.toolCallId.startsWith("search__")) {
			searchCalls.push({
				toolCallId: tc.toolCallId,
				toolName: tc.toolName,
				args: tc.args ?? {},
				result: tc.result,
				isError: tc.isError,
			});
		} else if (tc.toolCallId.startsWith("indexer__")) {
			indexerCalls.push({
				toolCallId: tc.toolCallId,
				toolName: tc.toolName,
				args: tc.args ?? {},
				result: tc.result,
				isError: tc.isError,
			});
		} else {
			parts.push({
				type: "tool-call",
				toolCallId: tc.toolCallId,
				toolName: tc.toolName,
				args: tc.args ?? {},
				argsText: JSON.stringify(tc.args ?? {}),
				result: tc.result,
				isError: tc.isError,
			});
		}
	}

	// Add search results part if there are search tool calls
	if (searchCalls.length > 0) {
		parts.push({
			type: "search-results",
			searchStatus: state.searchPhase === "done" ? "done" : "searching",
			toolCalls: searchCalls,
		});
	}

	// Add indexer results part if there are indexer tool calls or indexer is active
	if (indexerCalls.length > 0 || state.indexerPhase !== "idle") {
		parts.push({
			type: "indexer-results",
			indexerStatus: state.indexerPhase === "done" ? "done" : "running",
			toolCalls: indexerCalls,
		});
	}

	for (const pc of parsedCalls) {
		parts.push({
			type: "tool-call",
			toolCallId: pc.id,
			toolName: pc.toolName,
			args: pc.args,
			argsText: JSON.stringify(pc.args),
			result: pc.result,
			isError: false,
		});
	}

	parts.push({ type: "text", text: cleanText });
	return parts;
}

function handleSseEvent(
	eventType: string,
	parsed: Record<string, unknown>,
	state: SseState,
): boolean {
	switch (eventType) {
		case "search_phase":
			if (parsed.status === "start") {
				state.searchPhase = "searching";
			} else if (parsed.status === "end") {
				state.searchPhase = "done";
			}
			return true;

		case "indexer_phase":
			if (parsed.status === "start") {
				state.indexerPhase = "running";
			} else if (parsed.status === "end") {
				state.indexerPhase = "done";
			}
			return true;

		case "content":
			if (parsed.content) {
				state.textContent += parsed.content as string;
				return true;
			}
			return false;

		case "tool_call_start":
			state.toolCalls.set(parsed.toolCallId as string, {
				toolCallId: parsed.toolCallId as string,
				toolName: parsed.toolName as string,
			});
			return true;

		case "tool_call_args": {
			const tc = state.toolCalls.get(parsed.toolCallId as string);
			if (tc) tc.args = parsed.args as Record<string, unknown>;
			return true;
		}

		case "tool_result": {
			const tc = state.toolCalls.get(parsed.toolCallId as string);
			if (tc) {
				tc.result = parsed.result as string;
				tc.isError = parsed.isError as boolean;
			}
			return true;
		}

		case "thinking_delta":
			if (parsed.text) {
				state.thinkingText += parsed.text as string;
				return true;
			}
			return false;

		default:
			return false;
	}
}

function processSseLine(
	line: string,
	state: SseState,
	ctx: { eventType: string },
): "done" | "updated" | null {
	if (line.startsWith("event: ")) {
		ctx.eventType = line.slice(7);
		return null;
	}
	if (!line.startsWith("data: ")) return null;

	const data = line.slice(6);
	if (data === "[DONE]") return "done";

	try {
		if (handleSseEvent(ctx.eventType, JSON.parse(data), state))
			return "updated";
	} catch {
		/* skip */
	}
	ctx.eventType = "content";
	return null;
}

async function* readSseStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	state: SseState,
): AsyncGenerator<ChatModelRunResult> {
	const decoder = new TextDecoder();
	let buffer = "";
	const ctx = { eventType: "content" };
	const snapshot = () =>
		({ content: buildContentParts(state) }) as ChatModelRunResult;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const raw of lines) {
				const line = raw.trim();
				if (!line) continue;

				const result = processSseLine(line, state, ctx);
				if (result === "done") {
					yield snapshot();
					return;
				}
				if (result === "updated") yield snapshot();
			}
		}
	} finally {
		reader.releaseLock();
	}

	if (state.textContent || state.toolCalls.size > 0 || state.thinkingText) {
		yield snapshot();
	}
}

type MsgRecord = Record<string, unknown> | null | undefined;

function extractAttachmentIds(message: unknown): string[] {
	const msg = message as MsgRecord;
	if (!msg) return [];

	const ids = new Set<string>();

	if (Array.isArray(msg.attachments)) {
		for (const att of msg.attachments) {
			const id = (att as MsgRecord)?.id;
			if (typeof id === "string" && id) ids.add(id);
		}
	}

	if (Array.isArray(msg.content)) {
		for (const part of msg.content as Array<Record<string, unknown>>) {
			if (part.type === "image" && typeof part.image === "string") {
				const match = (part.image as string).match(
					/\/chat\/attachments\/([^/]+)$/,
				);
				if (match) ids.add(match[1]);
			}
		}
	}

	return [...ids];
}

function extractUserText(message: unknown): string {
	const msg = message as Record<string, unknown> | null;
	if (!msg?.content || !Array.isArray(msg.content)) return "";
	return (
		msg.content
			.filter((part: { type: string }) => part.type === "text")
			.map((part: { text: string }) => part.text)
			.join("") || ""
	);
}

export function createWillowChatAdapter(
	conversationId: string,
): ChatModelAdapter {
	return {
		async *run({ messages, abortSignal }) {
			const lastMessage = messages[messages.length - 1];
			const userText = extractUserText(lastMessage);
			const attachmentIds = extractAttachmentIds(lastMessage);
			const expectedPriorCount = messages.length - 1;

			const response = await fetch(`${BASE_URL}/chat/stream`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					conversationId,
					message: userText,
					attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
					expectedPriorCount,
				}),
				signal: abortSignal,
			});

			if (!response.ok) {
				const errorText =
					response.status === 404
						? "This conversation no longer exists. Please start a new one."
						: `Something went wrong (${response.status}). Please try again.`;
				yield {
					content: [{ type: "text", text: errorText }],
					status: { type: "incomplete", reason: "error", error: errorText },
				} as ChatModelRunResult;
				return;
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");

			const state: SseState = {
				textContent: "",
				thinkingText: "",
				toolCalls: new Map<string, ToolCallState>(),
				searchPhase: "idle",
				indexerPhase: "idle",
			};

			yield* readSseStream(reader, state);
		},
	};
}
