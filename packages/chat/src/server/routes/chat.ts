import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { getDisallowedTools } from "../services/agent-tools.js";
import { createAgenticStream } from "../services/agentic-stream.js";
import {
	getMaintenanceStatus,
	notifyConversationComplete,
	runMaintenance,
} from "../services/maintenance.js";
import {
	getStream,
	startStream,
	subscribe,
} from "../services/stream-manager.js";

const log = createLogger("chat");
const db = new PrismaClient();

// Resolve the MCP server entry point
const MCP_SERVER_PATH = resolve(
	import.meta.dirname ?? ".",
	"../../../../mcp-server/dist/index.js",
);

const CHAT_SYSTEM_PROMPT = `You are Willow, a personal knowledge assistant with persistent memory. You have access to a tree-structured knowledge graph that stores facts about the user across conversations.

<memory_behavior>
RECALLING FACTS:
- Use search_memories to search your memory when the user asks about something you might know, or when recalling information would help your response.
- For simple greetings or general chat, don't search.
- You can search multiple times with different queries if needed.
- Be transparent: "I remember you mentioned..." or "I don't have that in my memory yet."

Memory updates happen automatically in the background — you don't need to store, update, or organize facts.
</memory_behavior>

<personality>
- Be warm and conversational, like a thoughtful friend with a great memory
- When you recall something, mention it naturally: "Oh, that reminds me — you mentioned..."
- Be honest about what you do and don't remember
- Keep responses concise unless the user wants detail
</personality>

<formatting>
- Use markdown for formatting
- Keep responses appropriately sized — short for simple facts, longer for complex discussions
- Use bullet points for lists of remembered facts
</formatting>`;

const streamRequestSchema = z.object({
	conversationId: z.string(),
	message: z.string(),
	attachmentIds: z.array(z.string()).optional(),
	expectedPriorCount: z.number().optional(),
});

export const chatRoutes = new Hono();

// List conversations
chatRoutes.get("/conversations", async (c) => {
	const conversations = await db.conversation.findMany({
		orderBy: { updatedAt: "desc" },
		select: {
			id: true,
			title: true,
			createdAt: true,
			updatedAt: true,
			_count: { select: { messages: true } },
		},
	});
	const result = conversations.map(({ _count, ...rest }) => ({
		...rest,
		messageCount: _count.messages,
	}));
	return c.json(result);
});

// Create conversation
chatRoutes.post("/conversations", async (c) => {
	const conversation = await db.conversation.create({
		data: {},
		select: { id: true, title: true, createdAt: true, updatedAt: true },
	});
	log.info("Conversation created");
	return c.json(conversation, 201);
});

// Get messages
chatRoutes.get("/conversations/:id/messages", async (c) => {
	const { id } = c.req.param();
	const messages = await db.message.findMany({
		where: { conversationId: id },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			role: true,
			content: true,
			toolCalls: true,
			createdAt: true,
			attachments: {
				select: { id: true, filename: true, contentType: true },
			},
		},
	});
	return c.json(messages);
});

// Delete conversation
chatRoutes.delete("/conversations/:id", async (c) => {
	const { id } = c.req.param();
	await db.conversation.delete({ where: { id } });
	log.info("Conversation deleted", { id });
	return c.json({ ok: true });
});

// Stream status
chatRoutes.get("/conversations/:id/stream-status", async (c) => {
	const { id } = c.req.param();
	const existing = getStream(id);
	return c.json(
		existing
			? { active: true, status: existing.status }
			: { active: false, status: null },
	);
});

// Reconnect to active stream
chatRoutes.post("/conversations/:id/stream-reconnect", async (c) => {
	const { id } = c.req.param();
	log.info("Stream reconnect", { id });
	const existingStream = getStream(id);
	if (!existingStream) {
		return c.json({ error: "No active stream" }, 404);
	}
	return pipeStreamToSSE(c, id);
});

// Stream chat
chatRoutes.post("/stream", async (c) => {
	const body = await c.req.json();
	const parsed = streamRequestSchema.safeParse(body);

	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten() }, 400);
	}

	const { conversationId, message, attachmentIds, expectedPriorCount } =
		parsed.data;

	log.info("Stream request", { conversationId, messageLength: message.length });

	const conversation = await db.conversation.findUnique({
		where: { id: conversationId },
	});
	if (!conversation) {
		return c.json({ error: "Conversation not found" }, 404);
	}

	// Reconnect to active stream
	const existingStream = getStream(conversationId);
	if (existingStream && existingStream.status === "streaming") {
		return pipeStreamToSSE(c, conversationId);
	}

	// Trim orphaned messages if needed
	if (expectedPriorCount !== undefined) {
		const existing = await db.message.findMany({
			where: { conversationId },
			orderBy: { createdAt: "asc" },
			select: { id: true },
		});
		if (existing.length > expectedPriorCount) {
			const idsToDelete = existing.slice(expectedPriorCount).map((m) => m.id);

			// Detach attachments before deletion so they survive the cascade
			await db.chatAttachment.updateMany({
				where: { messageId: { in: idsToDelete } },
				data: { messageId: null },
			});

			await db.message.deleteMany({ where: { id: { in: idsToDelete } } });
		}
	}

	// Persist user message
	const userMessage = await db.message.create({
		data: { conversationId, role: "user", content: message },
	});

	// Link attachments to this message
	if (attachmentIds && attachmentIds.length > 0) {
		await db.chatAttachment.updateMany({
			where: { id: { in: attachmentIds }, messageId: null },
			data: { messageId: userMessage.id },
		});
	}

	// Auto-title from first message
	const msgCount = await db.message.count({ where: { conversationId } });
	if (msgCount === 1) {
		const titleSource = message || "Image";
		const title =
			titleSource.length > 50 ? `${titleSource.slice(0, 50)}...` : titleSource;
		await db.conversation.update({
			where: { id: conversationId },
			data: { title },
		});
	}

	// Load history with attachment disk paths
	const history = await db.message.findMany({
		where: { conversationId },
		orderBy: { createdAt: "asc" },
		select: {
			role: true,
			content: true,
			attachments: { select: { diskPath: true } },
		},
	});

	// Collect image paths for CLI
	const allImagePaths = history.flatMap((msg) =>
		msg.attachments
			.map((att) => att.diskPath)
			.filter((p): p is string => p !== null),
	);
	const lastUserMsg = [...history].reverse().find((msg) => msg.role === "user");
	const newImagePaths = lastUserMsg
		? lastUserMsg.attachments
				.map((att) => att.diskPath)
				.filter((p): p is string => p !== null)
		: [];

	const cliStream = createAgenticStream({
		chatOptions: {
			messages: history as Array<{
				role: "system" | "user" | "assistant";
				content: string;
			}>,
			systemPrompt: CHAT_SYSTEM_PROMPT,
			mcpServerPath: MCP_SERVER_PATH,
			images: allImagePaths.length > 0 ? allImagePaths : undefined,
			newImages: newImagePaths.length > 0 ? newImagePaths : undefined,
			disallowedTools: getDisallowedTools("chat"),
		},
		userMessage: message,
		mcpServerPath: MCP_SERVER_PATH,
		conversationId,
	});

	startStream(conversationId, cliStream, db, () => {
		notifyConversationComplete(MCP_SERVER_PATH);
	});
	return pipeStreamToSSE(c, conversationId);
});

// Maintenance status
chatRoutes.get("/maintenance/status", (c) => {
	return c.json(getMaintenanceStatus());
});

// Trigger maintenance manually
chatRoutes.post("/maintenance/run", (c) => {
	log.info("Maintenance triggered manually");
	const job = runMaintenance({
		trigger: "manual",
		mcpServerPath: MCP_SERVER_PATH,
	});
	if (!job) {
		log.warn("Maintenance already running");
		return c.json({ error: "Maintenance already running" }, 409);
	}
	return c.json({ jobId: job.id });
});

function pipeStreamToSSE(
	c: Parameters<typeof streamSSE>[0],
	conversationId: string,
) {
	return streamSSE(c, async (sseStream) => {
		const handle = subscribe(conversationId, async (event, data) => {
			try {
				await sseStream.writeSSE({ data, event });
			} catch {
				log.debug("SSE client disconnected");
			}
		});

		if (!handle) {
			await sseStream.writeSSE({ data: "[DONE]", event: "done" });
			return;
		}

		try {
			await handle.delivered;
		} finally {
			handle.unsubscribe();
		}
	});
}
