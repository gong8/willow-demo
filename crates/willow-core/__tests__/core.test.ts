import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsGraphStore } from "../index.js";

describe("JsGraphStore", () => {
	let store: InstanceType<typeof JsGraphStore>;
	let tmpDir: string;
	let graphPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "willow-test-"));
		graphPath = join(tmpDir, "graph.json");
		store = JsGraphStore.open(graphPath);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("opens with a default root node", () => {
		const ctx = store.getContext("root");
		expect(ctx.node.id).toBe("root");
		expect(ctx.node.nodeType).toBe("root");
		expect(ctx.node.content).toBe("User");
		expect(ctx.ancestors).toHaveLength(0);
		expect(ctx.descendants).toHaveLength(0);
	});

	it("creates a node under root", () => {
		const node = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "Hobbies",
		});

		expect(node.id).toBeTruthy();
		expect(node.nodeType).toBe("category");
		expect(node.content).toBe("Hobbies");
		expect(node.parentId).toBe("root");
		expect(node.createdAt).toBeTruthy();
	});

	it("rejects invalid parent", () => {
		expect(() =>
			store.createNode({
				parentId: "nonexistent",
				nodeType: "category",
				content: "Test",
			}),
		).toThrow("Parent node not found");
	});

	it("rejects invalid node type", () => {
		expect(() =>
			store.createNode({
				parentId: "root",
				nodeType: "invalid",
				content: "Test",
			}),
		).toThrow("Invalid node type");
	});

	it("gets context with ancestors and descendants", () => {
		const cat = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "Work",
		});
		const detail = store.createNode({
			parentId: cat.id,
			nodeType: "detail",
			content: "Software engineer at Acme",
		});

		const ctx = store.getContext(cat.id, 2);
		expect(ctx.node.id).toBe(cat.id);
		expect(ctx.ancestors).toHaveLength(1);
		expect(ctx.ancestors[0].id).toBe("root");
		expect(ctx.descendants).toHaveLength(1);
		expect(ctx.descendants[0].id).toBe(detail.id);
	});

	it("updates node content and tracks history", () => {
		const node = store.createNode({
			parentId: "root",
			nodeType: "detail",
			content: "Favorite color: blue",
		});

		const updated = store.updateNode({
			nodeId: node.id,
			content: "Favorite color: green",
			reason: "Changed preference",
		});

		expect(updated.content).toBe("Favorite color: green");
		expect(updated.previousValues).toHaveLength(1);
		expect(updated.previousValues[0].oldContent).toBe("Favorite color: blue");
		expect(updated.previousValues[0].reason).toBe("Changed preference");
	});

	it("updates metadata without affecting content", () => {
		const node = store.createNode({
			parentId: "root",
			nodeType: "detail",
			content: "Original",
			metadata: { source: "chat" },
		});

		const updated = store.updateNode({
			nodeId: node.id,
			metadata: { source: "conversation", confidence: "high" },
		});

		expect(updated.content).toBe("Original");
		expect(updated.metadata.source).toBe("conversation");
		expect(updated.metadata.confidence).toBe("high");
		expect(updated.previousValues).toHaveLength(0);
	});

	it("deletes node and cascades to children", () => {
		const cat = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "Hobbies",
		});
		store.createNode({
			parentId: cat.id,
			nodeType: "detail",
			content: "Reading",
		});

		store.deleteNode(cat.id);

		const rootCtx = store.getContext("root");
		expect(rootCtx.node.children).toHaveLength(0);
		expect(rootCtx.descendants).toHaveLength(0);
	});

	it("cannot delete root", () => {
		expect(() => store.deleteNode("root")).toThrow("Cannot delete root");
	});

	it("creates and returns links", () => {
		const a = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "A",
		});
		const b = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "B",
		});

		const link = store.addLink({
			fromNode: a.id,
			toNode: b.id,
			relation: "related_to",
		});

		expect(link.id).toBeTruthy();
		expect(link.fromNode).toBe(a.id);
		expect(link.toNode).toBe(b.id);
		expect(link.relation).toBe("related_to");
	});

	it("rejects duplicate links", () => {
		const a = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "A",
		});
		const b = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "B",
		});

		store.addLink({ fromNode: a.id, toNode: b.id, relation: "related_to" });

		expect(() =>
			store.addLink({ fromNode: a.id, toNode: b.id, relation: "related_to" }),
		).toThrow("Duplicate link");
	});

	it("removes links when nodes are deleted", () => {
		const a = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "A",
		});
		const b = store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "B",
		});
		store.addLink({ fromNode: a.id, toNode: b.id, relation: "related_to" });

		store.deleteNode(a.id);

		const ctx = store.getContext(b.id);
		expect(ctx.links).toHaveLength(0);
	});

	it("searches nodes by content", () => {
		store.createNode({
			parentId: "root",
			nodeType: "detail",
			content: "Loves playing guitar",
		});
		store.createNode({
			parentId: "root",
			nodeType: "detail",
			content: "Works at Google",
		});

		const results = store.searchNodes("guitar");
		expect(results).toHaveLength(1);
		expect(results[0].content).toContain("guitar");
		expect(results[0].score).toBeGreaterThan(0);
		expect(results[0].matchedField).toBe("content");
	});

	it("persists across reopens", () => {
		store.createNode({
			parentId: "root",
			nodeType: "category",
			content: "Persistent data",
		});

		const store2 = JsGraphStore.open(graphPath);
		const results = store2.searchNodes("Persistent");
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("Persistent data");
	});

	it("supports temporal metadata", () => {
		const node = store.createNode({
			parentId: "root",
			nodeType: "detail",
			content: "Lives in NYC",
			temporal: {
				validFrom: "2020-01-01T00:00:00Z",
				label: "residence",
			},
		});

		expect(node.temporal).toBeDefined();
		expect(node.temporal!.validFrom).toContain("2020");
		expect(node.temporal!.label).toBe("residence");
	});
});
