import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import type { Context } from "hono";
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

function storeHandler(
	label: string,
	fn: (store: InstanceType<typeof JsGraphStore>, c: Context) => unknown,
	errorStatus: 400 | 404 = 400,
) {
	return async (c: Context) => {
		try {
			const store = getStore();
			const result = await fn(store, c);
			return c.json(result);
		} catch (e: unknown) {
			log.error(`Failed to ${label}`, { error: (e as Error).message });
			return c.json({ error: (e as Error).message }, errorStatus);
		}
	};
}

function isDiffNonEmpty(store: InstanceType<typeof JsGraphStore>): boolean {
	try {
		const d = store.diffDiskVsHead();
		return (
			d.nodesCreated.length > 0 ||
			d.nodesUpdated.length > 0 ||
			d.nodesDeleted.length > 0 ||
			d.linksCreated.length > 0 ||
			d.linksRemoved.length > 0 ||
			d.linksUpdated.length > 0
		);
	} catch {
		return false;
	}
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

// GET /children/:nodeId — direct children (for scope picker)
graphRoutes.get("/children/:nodeId", (c) => {
	try {
		const store = getStore();
		const nodeId = c.req.param("nodeId");
		const ctx = store.getContext(nodeId, 1);
		const children = ctx.descendants
			.filter((n) => n.parentId === nodeId)
			.map((n) => ({
				id: n.id,
				content: n.content,
				nodeType: n.nodeType,
				childCount: n.children.length,
			}));
		return c.json(children);
	} catch (e: unknown) {
		log.error("Failed to get children", { error: (e as Error).message });
		return c.json({ error: (e as Error).message }, 400);
	}
});

graphRoutes.get("/status", (c) => {
	try {
		const store = getStore();
		const headHash = store.headHash() ?? null;
		const hasLocalChanges =
			headHash && existsSync(GRAPH_PATH) ? isDiffNonEmpty(store) : false;
		return c.json({ headHash, hasLocalChanges });
	} catch (e: unknown) {
		log.error("Failed to get status", { error: (e as Error).message });
		return c.json({ headHash: null, hasLocalChanges: false });
	}
});

graphRoutes.get(
	"/status/diff",
	storeHandler("get local diff", (store) => store.diffDiskVsHead()),
);

graphRoutes.get(
	"/log",
	storeHandler("get log", (store, c) => {
		const limit = Number(c.req.query("limit") ?? 20);
		return store.log(limit);
	}),
);

graphRoutes.get(
	"/commits/:hash",
	storeHandler(
		"get commit",
		(store, c) => store.showCommit(c.req.param("hash")),
		404,
	),
);

graphRoutes.get(
	"/branches",
	storeHandler("list branches", (store) => store.listBranches()),
);

graphRoutes.post(
	"/branches",
	storeHandler("create branch", async (store, c) => {
		const body = await c.req.json<{ name: string }>();
		store.createBranch(body.name);
		return { ok: true, name: body.name };
	}),
);

graphRoutes.post(
	"/branches/:name/switch",
	storeHandler("switch branch", (store, c) => {
		const name = c.req.param("name");
		store.switchBranch(name);
		return { ok: true, branch: name };
	}),
);

graphRoutes.delete(
	"/branches/:name",
	storeHandler("delete branch", (store, c) => {
		store.deleteBranch(c.req.param("name"));
		return { ok: true };
	}),
);

graphRoutes.post(
	"/merge",
	storeHandler("merge", async (store, c) => {
		const body = await c.req.json<{ source: string }>();
		const hash = store.mergeBranch(body.source);
		return { ok: true, hash };
	}),
);

graphRoutes.post(
	"/restore",
	storeHandler("restore", async (store, c) => {
		const body = await c.req.json<{ hash: string }>();
		const hash = store.restoreToCommit(body.hash);
		return { ok: true, hash };
	}),
);

graphRoutes.get(
	"/diff",
	storeHandler("diff", (store, c) => {
		const from = c.req.query("from");
		const to = c.req.query("to");
		if (!from || !to) {
			throw new Error("Both 'from' and 'to' query params required");
		}
		return store.diff(from, to);
	}),
);

graphRoutes.get(
	"/at/:hash",
	storeHandler(
		"get graph at commit",
		(store, c) => JSON.parse(store.graphAtCommit(c.req.param("hash"))),
		404,
	),
);
