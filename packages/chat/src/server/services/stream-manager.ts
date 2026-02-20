import type { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import type { SSEEmitter, ToolCallData } from "./cli-chat.js";
import { LineBuffer } from "./line-buffer.js";

const log = createLogger("stream-manager");

interface BufferedEvent {
	event: string;
	data: string;
}

export interface ActiveStream {
	conversationId: string;
	events: BufferedEvent[];
	status: "streaming" | "complete" | "error";
	fullContent: string;
	toolCallsData: ToolCallData[];
	subscribers: Set<SSEEmitter>;
	done: Promise<void>;
}

interface ParseState {
	toolCallIndex: Map<string, number>;
	searchActive: boolean;
	indexerActive: boolean;
	currentEventType: string;
}

function stripToolCallXml(text: string): string {
	return text
		.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
		.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const CLEANUP_DELAY_MS = 60_000;
const activeStreams = new Map<string, ActiveStream>();

async function persistMessage(
	db: PrismaClient,
	conversationId: string,
	content: string,
	toolCallsData: ToolCallData[],
): Promise<void> {
	await db.message.create({
		data: {
			conversationId,
			role: "assistant",
			content: stripToolCallXml(content),
			toolCalls:
				toolCallsData.length > 0 ? JSON.stringify(toolCallsData) : null,
		},
	});
	await db.conversation.update({
		where: { id: conversationId },
		data: { updatedAt: new Date() },
	});
}

async function safePersist(
	db: PrismaClient,
	conversationId: string,
	stream: ActiveStream,
): Promise<void> {
	if (!stream.fullContent && stream.toolCallsData.length === 0) return;
	try {
		await persistMessage(
			db,
			conversationId,
			stream.fullContent,
			stream.toolCallsData,
		);
	} catch {
		log.warn("Persist failed", { conversationId });
	}
}

function updateStreamState(
	stream: ActiveStream,
	state: ParseState,
	eventType: string,
	parsed: Record<string, unknown>,
): void {
	if (eventType === "search_phase") {
		state.searchActive = parsed.status === "start";
		return;
	}
	if (eventType === "indexer_phase") {
		state.indexerActive = parsed.status === "start";
		return;
	}

	if (eventType === "content" && parsed.content) {
		stream.fullContent += parsed.content;
		return;
	}

	if (eventType === "tool_call_start") {
		const idx = stream.toolCallsData.length;
		const phase = state.searchActive
			? "search"
			: state.indexerActive
				? "indexer"
				: "chat";
		stream.toolCallsData.push({
			toolCallId: parsed.toolCallId as string,
			toolName: parsed.toolName as string,
			args: {},
			phase,
		});
		state.toolCallIndex.set(parsed.toolCallId as string, idx);
		return;
	}

	const idx = state.toolCallIndex.get(parsed.toolCallId as string);
	if (idx === undefined) return;

	if (eventType === "tool_call_args") {
		stream.toolCallsData[idx].args = parsed.args as Record<string, unknown>;
	} else if (eventType === "tool_result") {
		stream.toolCallsData[idx].result = parsed.result as string;
		stream.toolCallsData[idx].isError = parsed.isError as boolean;
	}
}

function parseSSELine(
	line: string,
	state: ParseState,
): { type: string; data: string } | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("event: ")) {
		state.currentEventType = trimmed.slice(7);
		return null;
	}

	if (!trimmed.startsWith("data: ")) return null;
	const data = trimmed.slice(6);
	const type = state.currentEventType;
	state.currentEventType = "content";
	return { type, data };
}

async function generateTitle(
	db: PrismaClient,
	conversationId: string,
): Promise<string | null> {
	const messages = await db.message.findMany({
		where: { conversationId },
		orderBy: { createdAt: "asc" },
		take: 2,
		select: { role: true, content: true },
	});
	if (messages.length < 1) return null;
	const userMsg = messages.find((m) => m.role === "user");
	if (!userMsg) return null;
	const title =
		userMsg.content.length > 50
			? `${userMsg.content.slice(0, 50)}...`
			: userMsg.content;
	await db.conversation.update({
		where: { id: conversationId },
		data: { title },
	});
	return title;
}

async function finalizeStream(
	stream: ActiveStream,
	db: PrismaClient,
	emit: SSEEmitter,
	status: "complete" | "error",
): Promise<void> {
	await safePersist(db, stream.conversationId, stream);

	if (status === "complete") {
		const title = await generateTitle(db, stream.conversationId);
		if (title) {
			emit("title", JSON.stringify({ title }));
		}
	}

	stream.status = status;
	if (status === "error") {
		emit("error", JSON.stringify({ error: "Stream failed" }));
	}
	emit("done", "[DONE]");
}

function scheduleCleanup(conversationId: string): void {
	setTimeout(() => {
		activeStreams.delete(conversationId);
	}, CLEANUP_DELAY_MS);
}

async function consumeStream(
	stream: ActiveStream,
	cliStream: ReadableStream<Uint8Array>,
	db: PrismaClient,
	emit: SSEEmitter,
	onComplete?: (fullContent: string) => void,
): Promise<void> {
	const reader = cliStream.getReader();
	const decoder = new TextDecoder();
	const lineBuffer = new LineBuffer();
	const state: ParseState = {
		toolCallIndex: new Map(),
		searchActive: false,
		indexerActive: false,
		currentEventType: "content",
	};
	let status: "complete" | "error" = "complete";

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;

			for (const line of lineBuffer.push(
				decoder.decode(value, { stream: true }),
			)) {
				const parsed = parseSSELine(line, state);
				if (!parsed || parsed.data === "[DONE]") continue;

				try {
					const obj = JSON.parse(parsed.data);
					updateStreamState(stream, state, parsed.type, obj);
					emit(parsed.type, JSON.stringify(obj));
				} catch {
					log.debug("SSE parse error");
				}
			}
		}
	} catch {
		log.error("Stream consumption error");
		status = "error";
	} finally {
		reader.releaseLock();
	}

	await finalizeStream(stream, db, emit, status);
	if (status === "complete" && onComplete) {
		try {
			onComplete(stream.fullContent);
		} catch {
			log.warn("onComplete error");
		}
	}
	scheduleCleanup(stream.conversationId);
}

function createEmitter(stream: ActiveStream): SSEEmitter {
	return (event, data) => {
		stream.events.push({ event, data });
		for (const cb of stream.subscribers) {
			try {
				cb(event, data);
			} catch {
				log.warn("Subscriber error");
			}
		}
	};
}

export function startStream(
	conversationId: string,
	cliStream: ReadableStream<Uint8Array>,
	db: PrismaClient,
	onComplete?: (fullContent: string) => void,
): ActiveStream {
	const existing = activeStreams.get(conversationId);
	if (existing && existing.status === "streaming") {
		log.debug("Reusing existing stream", { conversationId });
		return existing;
	}
	log.info("Stream started", { conversationId });

	const stream: ActiveStream = {
		conversationId,
		events: [],
		status: "streaming",
		fullContent: "",
		toolCallsData: [],
		subscribers: new Set(),
		done: Promise.resolve(),
	};

	stream.done = consumeStream(
		stream,
		cliStream,
		db,
		createEmitter(stream),
		onComplete,
	);
	activeStreams.set(conversationId, stream);
	return stream;
}

export function getStream(conversationId: string): ActiveStream | undefined {
	return activeStreams.get(conversationId);
}

export interface SubscribeHandle {
	unsubscribe: () => void;
	delivered: Promise<void>;
}

export function subscribe(
	conversationId: string,
	cb: SSEEmitter,
): SubscribeHandle | null {
	const stream = activeStreams.get(conversationId);
	if (!stream) return null;

	let active = true;
	let resolveDelivered: () => void;
	const delivered = new Promise<void>((resolve) => {
		resolveDelivered = resolve;
	});

	const forward: SSEEmitter = (event, data) => {
		if (!active) return;
		try {
			cb(event, data);
		} catch {
			log.warn("Subscriber error");
		}
		if (stream.status !== "streaming") resolveDelivered();
	};

	for (const { event, data } of stream.events) {
		forward(event, data);
	}

	if (stream.status === "streaming") {
		stream.subscribers.add(forward);
	} else {
		resolveDelivered!();
	}

	return {
		unsubscribe: () => {
			active = false;
			stream.subscribers.delete(forward);
			resolveDelivered();
		},
		delivered,
	};
}
