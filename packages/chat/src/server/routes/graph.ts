import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { Hono } from "hono";
import { JsGraphStore } from "@willow/core";

const GRAPH_PATH =
	process.env.WILLOW_GRAPH_PATH ?? resolve(homedir(), ".willow", "graph.json");

const EMPTY_GRAPH = { root_id: "root", nodes: {}, links: {} };

export const graphRoutes = new Hono();

// Lazy-loaded store instance for VCS operations
let _store: InstanceType<typeof JsGraphStore> | null = null;
function getStore(): InstanceType<typeof JsGraphStore> {
	if (!_store) {
		_store = JsGraphStore.open(GRAPH_PATH);
		// Auto-init VCS if not already initialized
		try {
			_store.currentBranch();
		} catch {
			try {
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
		return c.json(EMPTY_GRAPH);
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
		return c.json({ error: (e as Error).message }, 400);
	}
});

// GET /at/:hash — graph state at a specific commit
graphRoutes.get("/at/:hash", (c) => {
	try {
		const store = getStore();
		const hash = c.req.param("hash");
		// Use showCommit to verify the commit exists, then reconstruct
		// by checking out and reading the graph
		store.showCommit(hash); // verify exists
		// Return the diff info — the full graph at commit would require
		// checkout which modifies state. For read-only, return the diff.
		const detail = store.showCommit(hash);
		return c.json(detail);
	} catch (e: unknown) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
