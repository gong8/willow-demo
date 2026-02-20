import { describe, expect, it } from "vitest";
import { runPreScan } from "../pre-scan.js";
import type { RawGraph, RawLink, RawNode } from "../types.js";

function makeNode(id: string, overrides?: Partial<RawNode>): RawNode {
	return {
		id,
		node_type: "detail",
		content: `Node ${id}`,
		parent_id: null,
		children: [],
		metadata: {},
		temporal: null,
		created_at: "2025-01-01T00:00:00Z",
		updated_at: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

function makeLink(
	id: string,
	from: string,
	to: string,
	relation = "related_to",
): RawLink {
	return {
		id,
		from_node: from,
		to_node: to,
		relation,
		bidirectional: false,
		confidence: null,
		created_at: "2025-01-01T00:00:00Z",
	};
}

function makeGraph(
	nodes: Record<string, RawNode>,
	links: Record<string, RawLink> = {},
): RawGraph {
	return { root_id: "root", nodes, links };
}

describe("pre-scan", () => {
	it("returns no findings for a healthy graph", () => {
		const graph = makeGraph({
			root: makeNode("root", {
				node_type: "root",
				content: "Root",
				children: ["cat1"],
			}),
			cat1: makeNode("cat1", {
				parent_id: "root",
				content: "Category 1",
			}),
		});
		const findings = runPreScan(graph);
		expect(findings).toHaveLength(0);
	});

	describe("link integrity", () => {
		it("detects broken link with missing source node", () => {
			const graph = makeGraph(
				{
					root: makeNode("root", {
						node_type: "root",
						children: ["a"],
					}),
					a: makeNode("a", { parent_id: "root" }),
				},
				{
					link1: makeLink("link1", "missing", "a"),
				},
			);
			const findings = runPreScan(graph);
			const broken = findings.filter((f) => f.category === "broken_link");
			expect(broken.length).toBeGreaterThanOrEqual(1);
			expect(broken[0].linkIds).toContain("link1");
		});

		it("detects broken link with missing target node", () => {
			const graph = makeGraph(
				{
					root: makeNode("root", {
						node_type: "root",
						children: ["a"],
					}),
					a: makeNode("a", { parent_id: "root" }),
				},
				{
					link1: makeLink("link1", "a", "missing"),
				},
			);
			const findings = runPreScan(graph);
			const broken = findings.filter((f) => f.category === "broken_link");
			expect(broken.length).toBeGreaterThanOrEqual(1);
		});

		it("detects self-links", () => {
			const graph = makeGraph(
				{
					root: makeNode("root", {
						node_type: "root",
						children: ["a"],
					}),
					a: makeNode("a", { parent_id: "root" }),
				},
				{
					link1: makeLink("link1", "a", "a"),
				},
			);
			const findings = runPreScan(graph);
			const selfLinks = findings.filter(
				(f) => f.category === "broken_link" && f.title.includes("Self-link"),
			);
			expect(selfLinks).toHaveLength(1);
		});
	});

	describe("orphan detection", () => {
		it("detects orphan nodes unreachable from root", () => {
			const graph = makeGraph({
				root: makeNode("root", {
					node_type: "root",
					children: ["a"],
				}),
				a: makeNode("a", { parent_id: "root" }),
				orphan: makeNode("orphan", { content: "I am lost" }),
			});
			const findings = runPreScan(graph);
			const orphans = findings.filter((f) => f.category === "orphan_node");
			expect(orphans).toHaveLength(1);
			expect(orphans[0].nodeIds).toContain("orphan");
		});

		it("detects broken parent reference", () => {
			const graph = makeGraph({
				root: makeNode("root", {
					node_type: "root",
					children: ["a"],
				}),
				a: makeNode("a", { parent_id: "nonexistent" }),
			});
			const findings = runPreScan(graph);
			const brokenParent = findings.filter(
				(f) => f.category === "broken_parent",
			);
			expect(brokenParent.length).toBeGreaterThanOrEqual(1);
		});

		it("detects parent-child mismatch", () => {
			const graph = makeGraph({
				root: makeNode("root", {
					node_type: "root",
					children: [], // Does NOT list "a" as child
				}),
				a: makeNode("a", { parent_id: "root" }),
			});
			const findings = runPreScan(graph);
			// "a" claims root as parent but root doesn't list "a" as child
			// Also "a" is an orphan since root's children array doesn't include it
			const brokenParent = findings.filter(
				(f) => f.category === "broken_parent",
			);
			expect(brokenParent.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("expired temporal", () => {
		it("detects expired temporal metadata", () => {
			const graph = makeGraph({
				root: makeNode("root", {
					node_type: "root",
					children: ["a"],
				}),
				a: makeNode("a", {
					parent_id: "root",
					content: "I used to be valid",
					temporal: {
						valid_from: "2024-01-01T00:00:00Z",
						valid_until: "2024-06-01T00:00:00Z",
						label: "temp",
					},
				}),
			});
			const findings = runPreScan(graph);
			const expired = findings.filter((f) => f.category === "expired_temporal");
			expect(expired).toHaveLength(1);
			expect(expired[0].nodeIds).toContain("a");
		});

		it("does not flag non-expired temporal metadata", () => {
			const graph = makeGraph({
				root: makeNode("root", {
					node_type: "root",
					children: ["a"],
				}),
				a: makeNode("a", {
					parent_id: "root",
					content: "Still valid",
					temporal: {
						valid_from: "2024-01-01T00:00:00Z",
						valid_until: "2099-01-01T00:00:00Z",
						label: "future",
					},
				}),
			});
			const findings = runPreScan(graph);
			const expired = findings.filter((f) => f.category === "expired_temporal");
			expect(expired).toHaveLength(0);
		});
	});

	it("assigns unique IDs to all findings", () => {
		const graph = makeGraph(
			{
				root: makeNode("root", {
					node_type: "root",
					children: ["a"],
				}),
				a: makeNode("a", { parent_id: "root" }),
				orphan1: makeNode("orphan1"),
				orphan2: makeNode("orphan2"),
			},
			{
				broken1: makeLink("broken1", "missing1", "a"),
				broken2: makeLink("broken2", "a", "missing2"),
			},
		);
		const findings = runPreScan(graph);
		const ids = findings.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^PRE-\d{3}$/);
		}
	});
});
