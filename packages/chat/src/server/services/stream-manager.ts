import type { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger";
import type { SSEEmitter, ToolCallData } from "./cli-chat";
import { readSSEStream } from "./sse-codec";

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

function stripToolCallXml(text: string): string {
	return text
		.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
		.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const CLEANUP_DELAY_MS = 60_000;
const activeStreams = new Map<string, ActiveStream>();

// -- Persistence --

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

// -- Stream state tracking --

interface ToolCallTracker {
	toolCallIndex: Map<string, number>;
	searchActive: boolean;
	indexerActive: boolean;
}

function processEvent(
	stream: ActiveStream,
	tracker: ToolCallTracker,
	eventType: string,
	parsed: Record<string, unknown>,
): void {
	if (eventType === "search_phase") {
		tracker.searchActive = parsed.status === "start";
		return;
	}
	if (eventType === "indexer_phase") {
		tracker.indexerActive = parsed.status === "start";
		return;
	}
	if (eventType === "content" && parsed.content) {
		stream.fullContent += parsed.content;
		return;
	}
	if (eventType === "tool_call_start") {
		const idx = stream.toolCallsData.length;
		const phase = tracker.searchActive
			? "search"
			: tracker.indexerActive
				? "indexer"
				: "chat";
		stream.toolCallsData.push({
			toolCallId: parsed.toolCallId as string,
			toolName: parsed.toolName as string,
			args: {},
			phase,
		});
		tracker.toolCallIndex.set(parsed.toolCallId as string, idx);
		return;
	}

	const idx = tracker.toolCallIndex.get(parsed.toolCallId as string);
	if (idx === undefined) return;

	if (eventType === "tool_call_args") {
		stream.toolCallsData[idx].args = parsed.args as Record<string, unknown>;
	} else if (eventType === "tool_result") {
		stream.toolCallsData[idx].result = parsed.result as string;
		stream.toolCallsData[idx].isError = parsed.isError as boolean;
	}
}

// -- Stream lifecycle --

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

async function consumeStream(
	stream: ActiveStream,
	cliStream: ReadableStream<Uint8Array>,
	db: PrismaClient,
	emit: SSEEmitter,
	onComplete?: (fullContent: string) => void,
): Promise<void> {
	const tracker: ToolCallTracker = {
		toolCallIndex: new Map(),
		searchActive: false,
		indexerActive: false,
	};
	let status: "complete" | "error" = "complete";

	try {
		await readSSEStream(cliStream, ({ type, data }) => {
			if (data === "[DONE]") return;
			try {
				const obj = JSON.parse(data);
				processEvent(stream, tracker, type, obj);
				emit(type, JSON.stringify(obj));
			} catch {
				log.debug("SSE parse error");
			}
		});
	} catch {
		log.error("Stream consumption error");
		status = "error";
	}

	await finalizeStream(stream, db, emit, status);
	if (status === "complete" && onComplete) {
		try {
			onComplete(stream.fullContent);
		} catch {
			log.warn("onComplete error");
		}
	}
	setTimeout(
		() => activeStreams.delete(stream.conversationId),
		CLEANUP_DELAY_MS,
	);
}

// -- Public API --

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
	let resolveDelivered!: () => void;
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
		resolveDelivered();
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
