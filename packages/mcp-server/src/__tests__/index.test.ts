import { describe, it, expect, vi, beforeEach } from "vitest";

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
	vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.clearAllMocks();
});

describe("mcp-server index", () => {
	it("registers all expected tools", async () => {
		// Import the module dynamically to trigger execution of side effects after mocks
		await import("../index.js");

		// Wait briefly for main() to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(registeredTools).toHaveProperty("search_nodes");
		expect(registeredTools).toHaveProperty("get_context");
		expect(registeredTools).toHaveProperty("create_node");
		expect(registeredTools).toHaveProperty("update_node");
		expect(registeredTools).toHaveProperty("delete_node");
		expect(registeredTools).toHaveProperty("add_link");
	});

	it("search_nodes calls store.searchNodes", async () => {
		const handler = registeredTools["search_nodes"];
		mockStore.searchNodes.mockReturnValue([{ id: "result1" }]);
		
		const res = await handler({ query: "test", maxResults: 5 });
		
		expect(mockStore.searchNodes).toHaveBeenCalledWith("test", 5);
		expect(res.content[0].text).toContain("result1");
	});

	it("search_nodes uses default maxResults", async () => {
		const handler = registeredTools["search_nodes"];
		mockStore.searchNodes.mockReturnValue([]);
		
		await handler({ query: "test" });
		expect(mockStore.searchNodes).toHaveBeenCalledWith("test", 10);
	});

	it("get_context calls store.getContext", async () => {
		const handler = registeredTools["get_context"];
		mockStore.getContext.mockReturnValue({ node: { id: "ctx1" } });
		
		const res = await handler({ nodeId: "n1", depth: 3 });
		
		expect(mockStore.getContext).toHaveBeenCalledWith("n1", 3);
		expect(res.content[0].text).toContain("ctx1");
	});

	it("get_context uses default depth", async () => {
		const handler = registeredTools["get_context"];
		await handler({ nodeId: "n1" });
		expect(mockStore.getContext).toHaveBeenCalledWith("n1", 2);
	});

	it("create_node calls store.createNode", async () => {
		const handler = registeredTools["create_node"];
		mockStore.createNode.mockReturnValue({ id: "new_node" });
		const input = { parentId: "p", nodeType: "detail", content: "val" };
		
		const res = await handler(input);
		
		expect(mockStore.createNode).toHaveBeenCalledWith(input);
		expect(res.content[0].text).toContain("new_node");
	});

	it("update_node calls store.updateNode", async () => {
		const handler = registeredTools["update_node"];
		mockStore.updateNode.mockReturnValue({ id: "updated_node" });
		const input = { nodeId: "n", content: "new_val" };
		
		const res = await handler(input);
		
		expect(mockStore.updateNode).toHaveBeenCalledWith(input);
		expect(res.content[0].text).toContain("updated_node");
	});

	it("delete_node calls store.deleteNode", async () => {
		const handler = registeredTools["delete_node"];
		
		const res = await handler({ nodeId: "del_n" });
		
		expect(mockStore.deleteNode).toHaveBeenCalledWith("del_n");
		expect(res.content[0].text).toContain("Deleted node del_n");
	});

	it("add_link calls store.addLink", async () => {
		const handler = registeredTools["add_link"];
		mockStore.addLink.mockReturnValue({ id: "new_link" });
		const input = { fromNode: "a", toNode: "b", relation: "rel" };
		
		const res = await handler(input);
		
		expect(mockStore.addLink).toHaveBeenCalledWith(input);
		expect(res.content[0].text).toContain("new_link");
	});
});
