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

function rootWithChild(childId: string) {
	return {
		root: makeNode("root", { node_type: "root", children: [childId] }),
		[childId]: makeNode(childId, { parent_id: "root" }),
	};
}

function findByCategory(
	findings: ReturnType<typeof runPreScan>,
	category: string,
) {
	return findings.filter((f) => f.category === category);
}

describe("pre-scan", () => {
	it("returns no findings for a healthy graph", () => {
		const graph = makeGraph({
			root: makeNode("root", {
				node_type: "root",
				content: "Root",
				children: ["cat1"],
			}),
			cat1: makeNode("cat1", { parent_id: "root", content: "Category 1" }),
		});
		expect(runPreScan(graph)).toHaveLength(0);
	});

	describe("link integrity", () => {
		it.each([
			["missing source node", "missing", "a"],
			["missing target node", "a", "missing"],
		])("detects broken link with %s", (_, from, to) => {
			const graph = makeGraph(rootWithChild("a"), {
				link1: makeLink("link1", from, to),
			});
			const broken = findByCategory(runPreScan(graph), "broken_link");
			expect(broken.length).toBeGreaterThanOrEqual(1);
			expect(broken[0].linkIds).toContain("link1");
		});

		it("detects self-links", () => {
			const graph = makeGraph(rootWithChild("a"), {
				link1: makeLink("link1", "a", "a"),
			});
			const selfLinks = runPreScan(graph).filter(
				(f) => f.category === "broken_link" && f.title.includes("Self-link"),
			);
			expect(selfLinks).toHaveLength(1);
		});
	});

	describe("orphan detection", () => {
		it("detects orphan nodes unreachable from root", () => {
			const graph = makeGraph({
				...rootWithChild("a"),
				orphan: makeNode("orphan", { content: "I am lost" }),
			});
			const orphans = findByCategory(runPreScan(graph), "orphan_node");
			expect(orphans).toHaveLength(1);
			expect(orphans[0].nodeIds).toContain("orphan");
		});

		it.each([
			[
				"broken parent reference",
				{
					root: makeNode("root", { node_type: "root", children: ["a"] }),
					a: makeNode("a", { parent_id: "nonexistent" }),
				},
			],
			[
				"parent-child mismatch",
				{
					root: makeNode("root", { node_type: "root", children: [] }),
					a: makeNode("a", { parent_id: "root" }),
				},
			],
		])("detects %s", (_, nodes) => {
			expect(
				findByCategory(runPreScan(makeGraph(nodes)), "broken_parent").length,
			).toBeGreaterThanOrEqual(1);
		});
	});

	describe("expired temporal", () => {
		function graphWithTemporal(validUntil: string) {
			return makeGraph({
				root: makeNode("root", { node_type: "root", children: ["a"] }),
				a: makeNode("a", {
					parent_id: "root",
					temporal: {
						valid_from: "2024-01-01T00:00:00Z",
						valid_until: validUntil,
						label: "temp",
					},
				}),
			});
		}

		it.each([
			["detects expired", "2024-06-01T00:00:00Z", 1],
			["ignores non-expired", "2099-01-01T00:00:00Z", 0],
		])("%s temporal metadata", (_, validUntil, expectedCount) => {
			const expired = findByCategory(
				runPreScan(graphWithTemporal(validUntil)),
				"expired_temporal",
			);
			expect(expired).toHaveLength(expectedCount);
		});
	});

	it("assigns unique IDs to all findings", () => {
		const graph = makeGraph(
			{
				...rootWithChild("a"),
				orphan1: makeNode("orphan1"),
				orphan2: makeNode("orphan2"),
			},
			{
				broken1: makeLink("broken1", "missing1", "a"),
				broken2: makeLink("broken2", "a", "missing2"),
			},
		);
		const ids = runPreScan(graph).map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^PRE-\d{3}$/);
		}
	});
});
