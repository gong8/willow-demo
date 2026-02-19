import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Hono } from "hono";

const GRAPH_PATH =
	process.env.WILLOW_GRAPH_PATH ?? resolve(homedir(), ".willow", "graph.json");

const EMPTY_GRAPH = { root_id: "root", nodes: {}, links: {} };

export const graphRoutes = new Hono();

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
