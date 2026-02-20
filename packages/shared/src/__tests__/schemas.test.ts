import { describe, expect, it } from "vitest";
import { CANONICAL_RELATIONS, schemas } from "../schemas.js";

describe("schemas", () => {
	describe("createNodeSchema", () => {
		it("validates valid input", () => {
			const input = {
				parentId: "root",
				nodeType: "category",
				content: "A test category",
				metadata: { source: "test" },
				temporal: { validFrom: "2020-01-01" },
			};
			expect(schemas.createNode.parse(input)).toEqual(input);
		});

		it("rejects invalid nodeType", () => {
			expect(() =>
				schemas.createNode.parse({
					parentId: "root",
					nodeType: "invalid_type",
					content: "Test",
				}),
			).toThrow(/Invalid enum value/);
		});

		it("allows minimal valid input", () => {
			const input = {
				parentId: "root",
				nodeType: "detail",
				content: "Minimal",
			};
			expect(schemas.createNode.parse(input)).toEqual(input);
		});
	});

	describe("updateNodeSchema", () => {
		it.each([
			[
				"full input",
				{
					nodeId: "node-123",
					content: "Updated content",
					reason: "Test update",
				},
			],
			["minimal input", { nodeId: "node-123" }],
		])("validates %s", (_, input) => {
			expect(schemas.updateNode.parse(input)).toEqual(input);
		});
	});

	describe("addLinkSchema", () => {
		const baseLinkInput = { fromNode: "node-A", toNode: "node-B" };

		it("validates valid input", () => {
			const input = { ...baseLinkInput, relation: "related_to" };
			expect(schemas.addLink.parse(input)).toEqual({
				...input,
				bidirectional: false,
			});
		});

		it("rejects non-canonical relation", () => {
			expect(() =>
				schemas.addLink.parse({
					...baseLinkInput,
					relation: "will_apply_domain_knowledge",
				}),
			).toThrow(/Invalid enum value/);
		});

		it("accepts all canonical relations", () => {
			for (const relation of CANONICAL_RELATIONS) {
				expect(schemas.addLink.parse({ ...baseLinkInput, relation })).toEqual({
					...baseLinkInput,
					relation,
					bidirectional: false,
				});
			}
		});
	});

	describe("searchNodesSchema", () => {
		it("applies default maxResults", () => {
			expect(schemas.searchNodes.parse({ query: "test query" })).toEqual({
				query: "test query",
				maxResults: 10,
			});
		});

		it("accepts explicit maxResults", () => {
			const input = { query: "test query", maxResults: 20 };
			expect(schemas.searchNodes.parse(input)).toEqual(input);
		});

		it.each([
			[0, /greater than or equal to 1/],
			[100, /less than or equal to 50/],
		])("rejects maxResults=%i", (maxResults, pattern) => {
			expect(() =>
				schemas.searchNodes.parse({ query: "q", maxResults }),
			).toThrow(pattern);
		});
	});

	describe("getContextSchema", () => {
		it("applies default depth", () => {
			expect(schemas.getContext.parse({ nodeId: "node-123" })).toEqual({
				nodeId: "node-123",
				depth: 2,
			});
		});

		it("accepts explicit depth", () => {
			const input = { nodeId: "node-123", depth: 5 };
			expect(schemas.getContext.parse(input)).toEqual(input);
		});
	});

	describe("deleteNodeSchema", () => {
		it("validates valid input", () => {
			expect(schemas.deleteNode.parse({ nodeId: "node-123" })).toEqual({
				nodeId: "node-123",
			});
		});
	});
});
