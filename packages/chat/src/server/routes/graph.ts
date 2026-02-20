import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { Hono } from "hono";
import { createLogger } from "../logger.js";

const log = createLogger("graph");

const GRAPH_PATH =
	process.env.WILLOW_GRAPH_PATH ?? resolve(homedir(), ".willow", "graph.json");

const EMPTY_GRAPH = { root_id: "root", nodes: {}, links: {} };

export const graphRoutes = new Hono();

// Lazy-loaded store instance for VCS operations
let _store: InstanceType<typeof JsGraphStore> | null = null;
function getStore(): InstanceType<typeof JsGraphStore> {
	if (!_store) {
		_store = JsGraphStore.open(GRAPH_PATH);
		log.info("Graph store initialized");
		// Auto-init VCS if not already initialized
		try {
			_store.currentBranch();
		} catch {
			try {
				log.debug("VCS auto-init");
				_store.vcsInit();
			} catch {
				// Already initialized or not supported
			}
		}
	}
	return _store;
}

// GET / — current graph state
graphRoutes.get("/", (c) => {
	if (!existsSync(GRAPH_PATH)) {
		return c.json(EMPTY_GRAPH);
	}

	try {
		const raw = readFileSync(GRAPH_PATH, "utf-8");
		const graph = JSON.parse(raw);
		return c.json(graph);
	} catch {
		log.warn("Graph file read failed");
		return c.json(EMPTY_GRAPH);
	}
});

// GET /status — HEAD hash + whether on-disk graph differs from last commit
graphRoutes.get("/status", (c) => {
	try {
		const store = getStore();
		const headHash = store.headHash() ?? null;

		let hasLocalChanges = false;
		if (headHash && existsSync(GRAPH_PATH)) {
			try {
				const diff = store.diffDiskVsHead();
				hasLocalChanges =
					diff.nodesCreated.length > 0 ||
					diff.nodesUpdated.length > 0 ||
					diff.nodesDeleted.length > 0 ||
					diff.linksCreated.length > 0 ||
					diff.linksRemoved.length > 0 ||
					diff.linksUpdated.length > 0;
			} catch {
				// If comparison fails, assume no changes
			}
		}

		return c.json({ headHash, hasLocalChanges });
	} catch (e: unknown) {
		log.error("Failed to get status", { error: (e as Error).message });
		return c.json({ headHash: null, hasLocalChanges: false });
	}
});

// GET /status/diff — diff between on-disk graph and HEAD commit
graphRoutes.get("/status/diff", (c) => {
	try {
		const store = getStore();
		const diff = store.diffDiskVsHead();
		return c.json(diff);
	} catch (e: unknown) {
		log.error("Failed to get local diff", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// GET /log — commit history
graphRoutes.get("/log", (c) => {
	try {
		const store = getStore();
		const limit = Number(c.req.query("limit") ?? 20);
		const entries = store.log(limit);
		return c.json(entries);
	} catch (e: unknown) {
		log.error("Failed to get log", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// GET /commits/:hash — commit details with diff
graphRoutes.get("/commits/:hash", (c) => {
	try {
		const store = getStore();
		const hash = c.req.param("hash");
		const detail = store.showCommit(hash);
		return c.json(detail);
	} catch (e: unknown) {
		log.error("Failed to get commit", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 404);
	}
});

// GET /branches — list branches
graphRoutes.get("/branches", (c) => {
	try {
		const store = getStore();
		const branches = store.listBranches();
		return c.json(branches);
	} catch (e: unknown) {
		log.error("Failed to list branches", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// POST /branches — create branch
graphRoutes.post("/branches", async (c) => {
	try {
		const store = getStore();
		const body = await c.req.json<{ name: string }>();
		store.createBranch(body.name);
		return c.json({ ok: true, name: body.name });
	} catch (e: unknown) {
		log.error("Failed to create branch", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// POST /branches/:name/switch — switch branch
graphRoutes.post("/branches/:name/switch", (c) => {
	try {
		const store = getStore();
		const name = c.req.param("name");
		store.switchBranch(name);
		return c.json({ ok: true, branch: name });
	} catch (e: unknown) {
		log.error("Failed to switch branch", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// DELETE /branches/:name — delete branch
graphRoutes.delete("/branches/:name", (c) => {
	try {
		const store = getStore();
		const name = c.req.param("name");
		store.deleteBranch(name);
		return c.json({ ok: true });
	} catch (e: unknown) {
		log.error("Failed to delete branch", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// POST /merge — merge branch
graphRoutes.post("/merge", async (c) => {
	try {
		const store = getStore();
		const body = await c.req.json<{ source: string }>();
		const hash = store.mergeBranch(body.source);
		return c.json({ ok: true, hash });
	} catch (e: unknown) {
		log.error("Failed to merge", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// POST /restore — restore graph to a previous commit
graphRoutes.post("/restore", async (c) => {
	try {
		const store = getStore();
		const body = await c.req.json<{ hash: string }>();
		const newHash = store.restoreToCommit(body.hash);
		return c.json({ ok: true, hash: newHash });
	} catch (e: unknown) {
		log.error("Failed to restore", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// GET /diff — diff between two commits
graphRoutes.get("/diff", (c) => {
	try {
		const store = getStore();
		const from = c.req.query("from");
		const to = c.req.query("to");
		if (!from || !to) {
			return c.json(
				{ error: "Both 'from' and 'to' query params required" },
				400,
			);
		}
		const changes = store.diff(from, to);
		return c.json(changes);
	} catch (e: unknown) {
		log.error("Failed to diff", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

// GET /at/:hash — graph state at a specific commit
graphRoutes.get("/at/:hash", (c) => {
	try {
		const store = getStore();
		const hash = c.req.param("hash");
		const graphJson = store.graphAtCommit(hash);
		const graph = JSON.parse(graphJson);
		return c.json(graph);
	} catch (e: unknown) {
		log.error("Failed to get graph at commit", {
			error: (e as Error).message,
		});
		return c.json({ error: (e as Error).message }, 404);
	}
});
