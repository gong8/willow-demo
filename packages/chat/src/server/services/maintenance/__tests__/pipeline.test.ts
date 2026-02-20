import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs to provide a test graph
const testGraph = JSON.stringify({
	root_id: "root",
	nodes: {
		root: {
			id: "root",
			node_type: "root",
			content: "Root",
			parent_id: null,
			children: ["cat1", "cat2"],
			metadata: {},
			temporal: null,
			created_at: "2025-01-01T00:00:00Z",
			updated_at: "2025-01-01T00:00:00Z",
		},
		cat1: {
			id: "cat1",
			node_type: "category",
			content: "Personal",
			parent_id: "root",
			children: [],
			metadata: {},
			temporal: null,
			created_at: "2025-01-01T00:00:00Z",
			updated_at: "2025-01-01T00:00:00Z",
		},
		cat2: {
			id: "cat2",
			node_type: "category",
			content: "Work",
			parent_id: "root",
			children: [],
			metadata: {},
			temporal: null,
			created_at: "2025-01-01T00:00:00Z",
			updated_at: "2025-01-01T00:00:00Z",
		},
	},
	links: {},
});

vi.mock("node:fs", () => ({
	readFileSync: vi.fn(() => testGraph),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	rmSync: vi.fn(),
}));

// Mock the crawler and resolver to avoid spawning real CLI processes
vi.mock("../crawler.js", () => ({
	spawnCrawlers: vi.fn(async () => [
		{
			subtreeRoot: "cat1",
			subtreeContent: "Personal",
			nodesExplored: 1,
			findings: [],
		},
		{
			subtreeRoot: "cat2",
			subtreeContent: "Work",
			nodesExplored: 1,
			findings: [
				{
					id: "C2-001",
					category: "vague_content",
					severity: "suggestion",
					source: "crawler:cat2",
					title: "Vague node content",
					description: "Node content is too vague",
					nodeIds: ["cat2"],
					linkIds: [],
				},
			],
		},
	]),
}));

vi.mock("../resolver.js", () => ({
	spawnResolver: vi.fn(async () => ({ actionsExecuted: 1 })),
}));

import { spawnCrawlers } from "../crawler.js";
import { runMaintenancePipeline } from "../pipeline.js";
import { spawnResolver } from "../resolver.js";

describe("maintenance pipeline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs full maintenance pipeline", async () => {
		const report = await runMaintenancePipeline({
			mcpServerPath: "/mcp",
			trigger: "manual",
		});

		expect(report.graphStats.nodeCount).toBe(3);
		expect(report.graphStats.linkCount).toBe(0);
		expect(report.graphStats.categoryCount).toBe(2);
		expect(report.preScanFindings).toHaveLength(0); // Healthy graph
		expect(report.crawlerReports).toHaveLength(2);
		expect(report.resolverActions).toBe(1);
		expect(report.durationMs).toBeGreaterThanOrEqual(0);

		expect(spawnCrawlers).toHaveBeenCalledTimes(1);
		expect(spawnResolver).toHaveBeenCalledTimes(1);
	});

	it("passes pre-scan findings to crawlers", async () => {
		const report = await runMaintenancePipeline({
			mcpServerPath: "/mcp",
			trigger: "auto",
		});

		// spawnCrawlers should have been called with preScanFindings
		const call = vi.mocked(spawnCrawlers).mock.calls[0][0];
		expect(call.subtrees).toHaveLength(2);
		expect(call.mcpServerPath).toBe("/mcp");
		expect(call.preScanFindings).toBeDefined();
	});

	it("skips resolver when no findings", async () => {
		vi.mocked(spawnCrawlers).mockResolvedValueOnce([
			{
				subtreeRoot: "cat1",
				subtreeContent: "Personal",
				nodesExplored: 1,
				findings: [],
			},
			{
				subtreeRoot: "cat2",
				subtreeContent: "Work",
				nodesExplored: 1,
				findings: [],
			},
		]);

		const report = await runMaintenancePipeline({
			mcpServerPath: "/mcp",
			trigger: "manual",
		});

		expect(spawnResolver).not.toHaveBeenCalled();
		expect(report.resolverActions).toBe(0);
	});
});
