import { describe, it, expect } from "vitest";
import { schemas } from "../schemas.js";

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
			const input = {
				parentId: "root",
				nodeType: "invalid_type",
				content: "Test",
			};
			expect(() => schemas.createNode.parse(input)).toThrow(/Invalid enum value/);
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
		it("validates valid input", () => {
			const input = {
				nodeId: "node-123",
				content: "Updated content",
				reason: "Test update",
			};
			expect(schemas.updateNode.parse(input)).toEqual(input);
		});

		it("allows optional fields", () => {
			const input = { nodeId: "node-123" };
			expect(schemas.updateNode.parse(input)).toEqual(input);
		});
	});

	describe("addLinkSchema", () => {
		it("validates valid input", () => {
			const input = {
				fromNode: "node-A",
				toNode: "node-B",
				relation: "related_to",
			};
			expect(schemas.addLink.parse(input)).toEqual({
				...input,
				bidirectional: false,
			});
		});
	});

	describe("searchNodesSchema", () => {
		it("validates valid input with default maxResults", () => {
			const input = { query: "test query" };
			expect(schemas.searchNodes.parse(input)).toEqual({
				query: "test query",
				maxResults: 10,
			});
		});

		it("validates input with explicit maxResults", () => {
			const input = { query: "test query", maxResults: 20 };
			expect(schemas.searchNodes.parse(input)).toEqual(input);
		});

		it("rejects maxResults out of bounds", () => {
			expect(() => schemas.searchNodes.parse({ query: "q", maxResults: 0 })).toThrow(/greater than or equal to 1/);
			expect(() => schemas.searchNodes.parse({ query: "q", maxResults: 100 })).toThrow(/less than or equal to 50/);
		});
	});

	describe("getContextSchema", () => {
		it("validates valid input with default depth", () => {
			const input = { nodeId: "node-123" };
			expect(schemas.getContext.parse(input)).toEqual({
				nodeId: "node-123",
				depth: 2,
			});
		});

		it("validates input with explicit depth", () => {
			const input = { nodeId: "node-123", depth: 5 };
			expect(schemas.getContext.parse(input)).toEqual(input);
		});
	});

	describe("deleteNodeSchema", () => {
		it("validates valid input", () => {
			const input = { nodeId: "node-123" };
			expect(schemas.deleteNode.parse(input)).toEqual(input);
		});
	});
});
