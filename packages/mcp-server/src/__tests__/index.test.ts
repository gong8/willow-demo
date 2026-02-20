import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external dependencies before importing the module
vi.mock("fs", () => ({
	mkdirSync: vi.fn(),
}));

vi.mock("os", () => ({
	homedir: vi.fn(() => "/mock-home"),
}));

// Create mock store instance
const mockStore = {
	searchNodes: vi.fn(),
	getContext: vi.fn(),
	createNode: vi.fn(),
	updateNode: vi.fn(),
	deleteNode: vi.fn(),
	addLink: vi.fn(),
};

vi.mock("@willow/core", () => ({
	JsGraphStore: {
		open: vi.fn(() => mockStore),
	},
}));

// Capture the handlers registered by the index.ts module
const registeredTools: Record<string, any> = {};

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
	return {
		McpServer: vi.fn().mockImplementation(() => {
			return {
				tool: vi.fn((name, desc, shape, handler) => {
					registeredTools[name] = handler;
				}),
				connect: vi.fn().mockResolvedValue(undefined),
			};
		}),
	};
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
	return {
		StdioServerTransport: vi.fn(),
	};
});

// Polyfill process.exit to prevent tests from closing
const originalExit = process.exit;
beforeEach(() => {
	vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.clearAllMocks();
});

describe("mcp-server index", () => {
	it("registers all expected tools", async () => {
		await import("../index.js");
		await new Promise((resolve) => setTimeout(resolve, 0));

		for (const tool of [
			"search_nodes",
			"get_context",
			"create_node",
			"update_node",
			"delete_node",
			"add_link",
		]) {
			expect(registeredTools).toHaveProperty(tool);
		}
	});

	it("search_nodes calls store.searchNodes", async () => {
		mockStore.searchNodes.mockReturnValue([{ id: "result1" }]);
		const res = await registeredTools.search_nodes({
			query: "test",
			maxResults: 5,
		});
		expect(mockStore.searchNodes).toHaveBeenCalledWith("test", 5);
		expect(res.content[0].text).toContain("result1");
	});

	it("search_nodes uses default maxResults", async () => {
		mockStore.searchNodes.mockReturnValue([]);
		await registeredTools.search_nodes({ query: "test" });
		expect(mockStore.searchNodes).toHaveBeenCalledWith("test", 10);
	});

	it("get_context calls store.getContext", async () => {
		mockStore.getContext.mockReturnValue({ node: { id: "ctx1" } });
		const res = await registeredTools.get_context({ nodeId: "n1", depth: 3 });
		expect(mockStore.getContext).toHaveBeenCalledWith("n1", 3);
		expect(res.content[0].text).toContain("ctx1");
	});

	it("get_context uses default depth", async () => {
		await registeredTools.get_context({ nodeId: "n1" });
		expect(mockStore.getContext).toHaveBeenCalledWith("n1", 2);
	});

	it.each([
		[
			"create_node",
			"createNode",
			{ parentId: "p", nodeType: "detail", content: "val" },
			{ id: "new_node" },
		],
		[
			"update_node",
			"updateNode",
			{ nodeId: "n", content: "new_val" },
			{ id: "updated_node" },
		],
		[
			"add_link",
			"addLink",
			{ fromNode: "a", toNode: "b", relation: "rel" },
			{ id: "new_link" },
		],
	] as const)(
		"%s calls store.%s",
		async (toolName, storeMethod, input, returnVal) => {
			(mockStore as any)[storeMethod].mockReturnValue(returnVal);
			const res = await registeredTools[toolName](input);
			expect((mockStore as any)[storeMethod]).toHaveBeenCalledWith(input);
			expect(res.content[0].text).toContain(returnVal.id);
		},
	);

	it("delete_node calls store.deleteNode", async () => {
		const res = await registeredTools.delete_node({ nodeId: "del_n" });
		expect(mockStore.deleteNode).toHaveBeenCalledWith("del_n");
		expect(res.content[0].text).toContain("Deleted node del_n");
	});
});
