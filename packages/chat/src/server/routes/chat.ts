import { resolve } from "node:path";
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
} from "../services/maintenance/index.js";
import {
	getStream,
	startStream,
	subscribe,
} from "../services/stream-manager.js";
import { db } from "./db.js";
import { CHAT_SYSTEM_PROMPT } from "./system-prompt.js";

const log = createLogger("chat");

const MCP_SERVER_PATH = resolve(
	import.meta.dirname ?? ".",
	"../../../../mcp-server/dist/index.js",
);

const streamRequestSchema = z.object({
	conversationId: z.string(),
	message: z.string(),
	attachmentIds: z.array(z.string()).optional(),
	resourceIds: z.array(z.string()).optional(),
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
	return c.json(
		conversations.map(({ _count, ...rest }) => ({
			...rest,
			messageCount: _count.messages,
		})),
	);
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
	const messages = await db.message.findMany({
		where: { conversationId: c.req.param("id") },
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
	const id = c.req.param("id");
	await db.conversation.delete({ where: { id } });
	log.info("Conversation deleted", { id });
	return c.json({ ok: true });
});

// Stream status
chatRoutes.get("/conversations/:id/stream-status", async (c) => {
	const existing = getStream(c.req.param("id"));
	return c.json(
		existing
			? { active: true, status: existing.status }
			: { active: false, status: null },
	);
});

// Reconnect to active stream
chatRoutes.post("/conversations/:id/stream-reconnect", async (c) => {
	const id = c.req.param("id");
	log.info("Stream reconnect", { id });
	if (!getStream(id)) {
		return c.json({ error: "No active stream" }, 404);
	}
	return pipeStreamToSSE(c, id);
});

// Stream chat
chatRoutes.post("/stream", async (c) => {
	const parsed = streamRequestSchema.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten() }, 400);
	}

	const {
		conversationId,
		message,
		attachmentIds,
		resourceIds,
		expectedPriorCount,
	} = parsed.data;

	log.info("Stream request", { conversationId, messageLength: message.length });

	const conversation = await db.conversation.findUnique({
		where: { id: conversationId },
	});
	if (!conversation) {
		return c.json({ error: "Conversation not found" }, 404);
	}

	const existingStream = getStream(conversationId);
	if (existingStream && existingStream.status === "streaming") {
		return pipeStreamToSSE(c, conversationId);
	}

	await trimOrphanedMessages(conversationId, expectedPriorCount);

	const userMessage = await db.message.create({
		data: { conversationId, role: "user", content: message },
	});

	if (attachmentIds && attachmentIds.length > 0) {
		await db.chatAttachment.updateMany({
			where: { id: { in: attachmentIds }, messageId: null },
			data: { messageId: userMessage.id },
		});
	}

	await autoTitle(conversationId, message);

	const history = await db.message.findMany({
		where: { conversationId },
		orderBy: { createdAt: "asc" },
		select: {
			role: true,
			content: true,
			attachments: { select: { diskPath: true } },
		},
	});

	const { allImagePaths, newImagePaths } = collectImagePaths(history);
	const systemPrompt = await buildSystemPrompt(resourceIds);

	const cliStream = createAgenticStream({
		chatOptions: {
			messages: history as Array<{
				role: "system" | "user" | "assistant";
				content: string;
			}>,
			systemPrompt,
			mcpServerPath: MCP_SERVER_PATH,
			images: allImagePaths.length > 0 ? allImagePaths : undefined,
			newImages: newImagePaths.length > 0 ? newImagePaths : undefined,
			disallowedTools: getDisallowedTools("chat"),
			allowWebTools: true,
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

// --- Helpers ---

async function trimOrphanedMessages(
	conversationId: string,
	expectedPriorCount: number | undefined,
) {
	if (expectedPriorCount === undefined) return;

	const existing = await db.message.findMany({
		where: { conversationId },
		orderBy: { createdAt: "asc" },
		select: { id: true },
	});
	if (existing.length <= expectedPriorCount) return;

	const idsToDelete = existing.slice(expectedPriorCount).map((m) => m.id);
	await db.chatAttachment.updateMany({
		where: { messageId: { in: idsToDelete } },
		data: { messageId: null },
	});
	await db.message.deleteMany({ where: { id: { in: idsToDelete } } });
}

async function autoTitle(conversationId: string, message: string) {
	const msgCount = await db.message.count({ where: { conversationId } });
	if (msgCount !== 1) return;

	const titleSource = message || "Image";
	const title =
		titleSource.length > 50 ? `${titleSource.slice(0, 50)}...` : titleSource;
	await db.conversation.update({
		where: { id: conversationId },
		data: { title },
	});
}

function diskPaths(attachments: { diskPath: string | null }[]) {
	return attachments
		.map((a) => a.diskPath)
		.filter((p): p is string => p !== null);
}

function collectImagePaths(
	history: { role: string; attachments: { diskPath: string | null }[] }[],
) {
	const allImagePaths = history.flatMap((msg) => diskPaths(msg.attachments));
	const lastUserMsg = [...history].reverse().find((msg) => msg.role === "user");
	const newImagePaths = lastUserMsg ? diskPaths(lastUserMsg.attachments) : [];
	return { allImagePaths, newImagePaths };
}

const MAX_RESOURCE_TEXT = 30_000;

async function buildSystemPrompt(
	resourceIds: string[] | undefined,
): Promise<string> {
	if (!resourceIds || resourceIds.length === 0) return CHAT_SYSTEM_PROMPT;

	const resources = await db.resource.findMany({
		where: {
			id: { in: resourceIds },
			status: { in: ["ready", "indexed"] },
		},
		select: { id: true, name: true, extractedText: true },
	});

	const resourceBlocks = resources
		.filter(
			(r): r is typeof r & { extractedText: string } => r.extractedText != null,
		)
		.map((r) => {
			const text =
				r.extractedText.length > MAX_RESOURCE_TEXT
					? `${r.extractedText.slice(0, MAX_RESOURCE_TEXT)}\n[... truncated]`
					: r.extractedText;
			return `<resource id="${r.id}" name="${r.name}">\n${text}\n</resource>`;
		});

	if (resourceBlocks.length === 0) return CHAT_SYSTEM_PROMPT;
	return `${CHAT_SYSTEM_PROMPT}\n\n<attached_resources>\n${resourceBlocks.join("\n\n")}\n</attached_resources>`;
}

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
