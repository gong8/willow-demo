#!/usr/bin/env node

import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JsGraphStore } from "@willow/core";
import { schemas } from "@willow/shared";

const graphPath =
	process.env.WILLOW_GRAPH_PATH ?? join(homedir(), ".willow", "graph.json");

// Ensure directory exists
mkdirSync(join(graphPath, ".."), { recursive: true });

const store = JsGraphStore.open(graphPath);

const server = new McpServer({
	name: "willow",
	version: "0.1.0",
});

// search_nodes
server.tool(
	"search_nodes",
	"Search the knowledge graph for nodes matching a query. Use this to find existing facts before creating new ones.",
	schemas.searchNodes.shape,
	async ({ query, maxResults }) => {
		const results = store.searchNodes(query, maxResults ?? 10);
		return {
			content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
		};
	},
);

// get_context
server.tool(
	"get_context",
	"Get a node with its ancestors (path to root) and descendants (up to depth). Use this to understand where a fact sits in the knowledge tree.",
	schemas.getContext.shape,
	async ({ nodeId, depth }) => {
		const ctx = store.getContext(nodeId, depth ?? 2);
		return {
			content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }],
		};
	},
);

// create_node
server.tool(
	"create_node",
	"Create a new node in the knowledge graph. Use 'category' for grouping topics, 'detail' for individual facts. Always specify a parent node.",
	schemas.createNode.shape,
	async (input) => {
		const node = store.createNode(input);
		return {
			content: [{ type: "text", text: JSON.stringify(node, null, 2) }],
		};
	},
);

// update_node
server.tool(
	"update_node",
	"Update an existing node's content or metadata. When content changes, the old value is preserved in history with an optional reason.",
	schemas.updateNode.shape,
	async (input) => {
		const node = store.updateNode(input);
		return {
			content: [{ type: "text", text: JSON.stringify(node, null, 2) }],
		};
	},
);

// delete_node
server.tool(
	"delete_node",
	"Delete a node and all its descendants from the knowledge graph. Cannot delete the root node. Associated links are also removed.",
	schemas.deleteNode.shape,
	async ({ nodeId }) => {
		store.deleteNode(nodeId);
		return {
			content: [
				{ type: "text", text: `Deleted node ${nodeId} and all descendants.` },
			],
		};
	},
);

// add_link
server.tool(
	"add_link",
	"Create a directional link between two nodes. Use to represent cross-cutting relationships like 'related_to', 'contradicts', 'caused_by', etc.",
	schemas.addLink.shape,
	async (input) => {
		const link = store.addLink(input);
		return {
			content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
		};
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(`Willow MCP server running (graph: ${graphPath})`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
