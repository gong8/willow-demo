import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { JsGraphStore } from "@willow/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { createLogger } from "../logger.js";
import {
	RESOURCES_DIR,
	ensureResourcesDir,
	extractText,
	fetchAndExtractUrl,
	getExtension,
} from "../services/resource-extractor.js";
import { runResourceIndexer } from "../services/resource-indexer.js";

const log = createLogger("resources");
const db = new PrismaClient();

const MCP_SERVER_PATH = resolve(
	import.meta.dirname ?? ".",
	"../../../../mcp-server/dist/index.js",
);

const ALLOWED_CONTENT_TYPES = new Set([
	"application/pdf",
	"text/plain",
	"text/markdown",
]);

export const resourceRoutes = new Hono();

// List all resources
resourceRoutes.get("/", async (c) => {
	const resources = await db.resource.findMany({
		orderBy: { createdAt: "desc" },
		select: {
			id: true,
			name: true,
			resourceType: true,
			status: true,
			sourceUrl: true,
			contentType: true,
			fileSize: true,
			createdAt: true,
			updatedAt: true,
		},
	});
	return c.json(resources);
});

// Upload a file
resourceRoutes.post("/", async (c) => {
	const formData = await c.req.formData();
	const file = formData.get("file") as File | null;

	if (!file) {
		return c.json({ error: "No file provided" }, 400);
	}

	if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
		return c.json(
			{ error: "Only PDF, text, and markdown files are allowed" },
			400,
		);
	}

	const resource = await db.resource.create({
		data: {
			name: file.name,
			resourceType:
				file.type === "application/pdf"
					? "pdf"
					: file.type === "text/markdown"
						? "markdown"
						: "text",
			status: "extracting",
			contentType: file.type,
			fileSize: file.size,
		},
	});

	try {
		await ensureResourcesDir();
		const ext = getExtension(file.type);
		const diskPath = `${RESOURCES_DIR}/${resource.id}${ext}`;
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(diskPath, buffer);

		const text = await extractText(diskPath, file.type);

		await db.resource.update({
			where: { id: resource.id },
			data: {
				diskPath,
				extractedText: text,
				status: "ready",
			},
		});

		log.info("Resource uploaded", { id: resource.id, name: file.name });

		return c.json(
			{
				id: resource.id,
				name: resource.name,
				resourceType: resource.resourceType,
				status: "ready",
			},
			201,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Extraction failed";
		await db.resource.update({
			where: { id: resource.id },
			data: { status: "error", errorMessage: message },
		});
		log.error("Resource extraction failed", {
			id: resource.id,
			error: message,
		});
		return c.json({ error: message }, 500);
	}
});

// Create resource from URL
resourceRoutes.post("/url", async (c) => {
	const body = await c.req.json();
	const parsed = z.object({ url: z.string().url() }).safeParse(body);

	if (!parsed.success) {
		return c.json({ error: "Invalid URL" }, 400);
	}

	const { url } = parsed.data;

	const resource = await db.resource.create({
		data: {
			name: url,
			resourceType: "url",
			status: "extracting",
			sourceUrl: url,
		},
	});

	try {
		const { title, text, diskPath } = await fetchAndExtractUrl(
			url,
			resource.id,
		);

		await db.resource.update({
			where: { id: resource.id },
			data: {
				name: title,
				diskPath,
				extractedText: text,
				contentType: "text/html",
				fileSize: text.length,
				status: "ready",
			},
		});

		log.info("URL resource created", { id: resource.id, title });

		return c.json(
			{
				id: resource.id,
				name: title,
				resourceType: "url",
				status: "ready",
			},
			201,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Fetch failed";
		await db.resource.update({
			where: { id: resource.id },
			data: { status: "error", errorMessage: message },
		});
		log.error("URL fetch failed", { id: resource.id, error: message });
		return c.json({ error: message }, 500);
	}
});

// Get single resource
resourceRoutes.get("/:id", async (c) => {
	const { id } = c.req.param();
	const resource = await db.resource.findUnique({
		where: { id },
		select: {
			id: true,
			name: true,
			resourceType: true,
			status: true,
			sourceUrl: true,
			contentType: true,
			fileSize: true,
			errorMessage: true,
			indexContext: true,
			createdAt: true,
			updatedAt: true,
		},
	});
	if (!resource) {
		return c.json({ error: "Resource not found" }, 404);
	}
	return c.json(resource);
});

// Delete resource
resourceRoutes.delete("/:id", async (c) => {
	const { id } = c.req.param();
	const resource = await db.resource.findUnique({ where: { id } });
	if (!resource) {
		return c.json({ error: "Resource not found" }, 404);
	}

	if (resource.diskPath && existsSync(resource.diskPath)) {
		await rm(resource.diskPath, { force: true });
	}

	await db.resource.delete({ where: { id } });
	log.info("Resource deleted", { id });
	return c.json({ ok: true });
});

// Get extracted text content
resourceRoutes.get("/:id/content", async (c) => {
	const { id } = c.req.param();
	const resource = await db.resource.findUnique({
		where: { id },
		select: { extractedText: true },
	});
	if (!resource) {
		return c.json({ error: "Resource not found" }, 404);
	}
	return c.json({ text: resource.extractedText });
});

// Trigger indexing (SSE stream)
resourceRoutes.post("/:id/index", async (c) => {
	const { id } = c.req.param();
	const body = await c.req.json().catch(() => ({}));
	const context = (body as Record<string, unknown>).context as
		| string
		| undefined;

	const resource = await db.resource.findUnique({ where: { id } });
	if (!resource) {
		return c.json({ error: "Resource not found" }, 404);
	}

	if (resource.status === "indexing") {
		return c.json({ error: "Resource is already being indexed" }, 409);
	}

	if (
		resource.status !== "ready" &&
		resource.status !== "indexed" &&
		resource.status !== "error"
	) {
		return c.json(
			{ error: "Resource must be in ready, indexed, or error status" },
			400,
		);
	}

	const { extractedText } = resource;
	if (!extractedText) {
		return c.json({ error: "No extracted text available" }, 400);
	}

	await db.resource.update({
		where: { id },
		data: {
			status: "indexing",
			indexContext: context ?? resource.indexContext,
		},
	});

	return streamSSE(c, async (sseStream) => {
		try {
			await runResourceIndexer({
				resourceId: resource.id,
				resourceName: resource.name,
				extractedText,
				indexContext: context ?? resource.indexContext ?? undefined,
				mcpServerPath: MCP_SERVER_PATH,
				emitSSE: async (event, data) => {
					try {
						await sseStream.writeSSE({ data, event });
					} catch {
						log.debug("SSE client disconnected");
					}
				},
			});

			// Commit graph changes
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
					message: `Resource indexed: ${resource.name}`,
					source: "resource",
					conversationId: undefined,
					summary: resource.name,
					jobId: undefined,
					toolName: undefined,
				});
				log.info("VCS committed for resource", { id: resource.id });
			} catch {
				log.warn("VCS commit failed for resource");
			}

			await db.resource.update({
				where: { id },
				data: { status: "indexed" },
			});

			await sseStream.writeSSE({ data: "[DONE]", event: "done" });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Indexing failed";
			log.error("Resource indexing failed", {
				id: resource.id,
				error: message,
			});

			await db.resource.update({
				where: { id },
				data: { status: "error", errorMessage: message },
			});

			await sseStream.writeSSE({
				data: JSON.stringify({ error: message }),
				event: "error",
			});
			await sseStream.writeSSE({ data: "[DONE]", event: "done" });
		}
	});
});

// Serve original file
resourceRoutes.get("/:id/file", async (c) => {
	const { id } = c.req.param();
	const resource = await db.resource.findUnique({ where: { id } });
	if (!resource?.diskPath || !existsSync(resource.diskPath)) {
		return c.json({ error: "File not found" }, 404);
	}

	const data = await readFile(resource.diskPath);
	c.header("Content-Type", resource.contentType ?? "application/octet-stream");
	c.header("Content-Disposition", `inline; filename="${resource.name}"`);
	return c.body(data);
});
