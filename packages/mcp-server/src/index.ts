#!/usr/bin/env node

import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JsGraphStore } from "@willow/core";
import { schemas } from "@willow/shared";
import { createLogger } from "./logger.js";

const log = createLogger("mcp");

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
		try {
			log.info("search_nodes", { query, maxResults: maxResults ?? 10 });
			const results = store.searchNodes(query, maxResults ?? 10);
			log.debug("search_nodes result", { count: results.length });
			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		} catch (e) {
			log.error("search_nodes failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// get_context
server.tool(
	"get_context",
	"Get a node with its ancestors (path to root) and descendants (up to depth). Use this to understand where a fact sits in the knowledge tree.",
	schemas.getContext.shape,
	async ({ nodeId, depth }) => {
		try {
			log.info("get_context", { nodeId, depth: depth ?? 2 });
			const ctx = store.getContext(nodeId, depth ?? 2);
			return {
				content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }],
			};
		} catch (e) {
			log.error("get_context failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// create_node
server.tool(
	"create_node",
	"Create a new node in the knowledge graph. Types: 'category' for top-level grouping, 'collection' for sub-groups, 'entity' for named things, 'attribute' for facts/properties, 'event' for time-bound occurrences, 'detail' for additional depth/elaboration. Always specify a parent node.",
	schemas.createNode.shape,
	async (input) => {
		try {
			log.info("create_node", {
				parentId: input.parentId,
				nodeType: input.nodeType,
			});
			const node = store.createNode(input);
			return {
				content: [{ type: "text", text: JSON.stringify(node, null, 2) }],
			};
		} catch (e) {
			log.error("create_node failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// update_node
server.tool(
	"update_node",
	"Update an existing node's content or metadata. When content changes, the old value is preserved in history with an optional reason.",
	schemas.updateNode.shape,
	async (input) => {
		try {
			log.info("update_node", { nodeId: input.nodeId });
			const node = store.updateNode(input);
			return {
				content: [{ type: "text", text: JSON.stringify(node, null, 2) }],
			};
		} catch (e) {
			log.error("update_node failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// delete_node
server.tool(
	"delete_node",
	"Delete a node and all its descendants from the knowledge graph. Cannot delete the root node. Associated links are also removed.",
	schemas.deleteNode.shape,
	async ({ nodeId }) => {
		try {
			log.info("delete_node", { nodeId });
			store.deleteNode(nodeId);
			return {
				content: [
					{ type: "text", text: `Deleted node ${nodeId} and all descendants.` },
				],
			};
		} catch (e) {
			log.error("delete_node failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// walk_graph
server.tool(
	"walk_graph",
	"Navigate the knowledge tree one step at a time. Use 'start' to begin at root, 'down' to enter a child, 'up' to backtrack to parent, 'follow_link' to follow a cross-cutting link to its other endpoint, 'done' to end. Returns the current position, path from root, children, and cross-cutting links.",
	schemas.walkGraph.shape,
	async ({ action, nodeId, linkId }) => {
		try {
			log.info("walk_graph", { action, nodeId, linkId });
			const formatView = (targetId: string) => {
				const ctx = store.getContext(targetId, 2);
				const position = {
					id: ctx.node.id,
					content: ctx.node.content,
					type: ctx.node.nodeType,
				};

				const path = [
					...ctx.ancestors.reverse().map((n) => ({
						id: n.id,
						content: n.content,
						type: n.nodeType,
					})),
					position,
				];

				const children = ctx.descendants
					.filter((n) => n.parentId === targetId)
					.map((n) => ({
						id: n.id,
						content: n.content,
						type: n.nodeType,
						childCount: n.children.length,
						children: ctx.descendants
							.filter((gc) => gc.parentId === n.id)
							.map((gc) => ({
								id: gc.id,
								content: gc.content.length > 80 ? gc.content.slice(0, 80) + "..." : gc.content,
								type: gc.nodeType,
								childCount: gc.children.length,
							})),
					}));

				// Build cross-cutting links touching the current node
				const links = ctx.links
					.filter(
						(l) => l.fromNode === targetId || l.toNode === targetId,
					)
					.map((l) => {
						const isOutgoing = l.fromNode === targetId;
						const otherNodeId = isOutgoing ? l.toNode : l.fromNode;
						// Get a short preview of the other node
						let targetContent = otherNodeId;
						try {
							const otherCtx = store.getContext(otherNodeId, 0);
							targetContent = otherCtx.node.content;
							if (targetContent.length > 60) {
								targetContent = `${targetContent.slice(0, 60)}...`;
							}
						} catch {
							// Node may not exist
						}
						const canFollow = isOutgoing || l.bidirectional;
						return {
							linkId: l.id,
							relation: l.relation,
							targetNodeId: otherNodeId,
							targetContent,
							direction: isOutgoing ? "outgoing" : "incoming",
							bidirectional: l.bidirectional,
							canFollow,
						};
					});

				return JSON.stringify(
					{ position, path, children, links },
					null,
					2,
				);
			};

			if (action === "start") {
				return {
					content: [{ type: "text", text: formatView("root") }],
				};
			}

			if (action === "done") {
				return {
					content: [{ type: "text", text: "Search complete." }],
				};
			}

			if (action === "down") {
				if (!nodeId) {
					return {
						content: [
							{
								type: "text",
								text: "Error: nodeId is required for 'down' action.",
							},
						],
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: formatView(nodeId) }],
				};
			}

			if (action === "up") {
				if (!nodeId) {
					return {
						content: [
							{
								type: "text",
								text: "Error: nodeId is required for 'up' action.",
							},
						],
						isError: true,
					};
				}
				const ctx = store.getContext(nodeId, 0);
				const parentId = ctx.node.parentId;
				if (!parentId) {
					return {
						content: [{ type: "text", text: "Already at root, cannot go up." }],
					};
				}
				return {
					content: [{ type: "text", text: formatView(parentId) }],
				};
			}

			if (action === "follow_link") {
				if (!nodeId || !linkId) {
					return {
						content: [
							{
								type: "text",
								text: "Error: both nodeId and linkId are required for 'follow_link' action.",
							},
						],
						isError: true,
					};
				}
				// Look up the link from the current node's context
				const ctx = store.getContext(nodeId, 0);
				const link = ctx.links.find((l) => l.id === linkId);
				if (!link) {
					return {
						content: [
							{
								type: "text",
								text: `Error: link ${linkId} not found on node ${nodeId}.`,
							},
						],
						isError: true,
					};
				}
				// Check directionality
				const isOutgoing = link.fromNode === nodeId;
				if (!isOutgoing && !link.bidirectional) {
					return {
						content: [
							{
								type: "text",
								text: `Error: link ${linkId} is directed and cannot be followed from node ${nodeId} (it is incoming and not bidirectional).`,
							},
						],
						isError: true,
					};
				}
				// Navigate to the other endpoint
				const targetNodeId = isOutgoing ? link.toNode : link.fromNode;
				return {
					content: [{ type: "text", text: formatView(targetNodeId) }],
				};
			}

			return {
				content: [{ type: "text", text: `Unknown action: ${action}` }],
				isError: true,
			};
		} catch (e) {
			log.error("walk_graph failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// delete_link
server.tool(
	"delete_link",
	"Delete a link between two nodes by its link ID.",
	schemas.deleteLink.shape,
	async ({ linkId }) => {
		try {
			log.info("delete_link", { linkId });
			const link = store.deleteLink(linkId);
			return {
				content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
			};
		} catch (e) {
			log.error("delete_link failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// add_link
server.tool(
	"add_link",
	"Create a link between two nodes. The relation MUST be one of: 'related_to', 'contradicts', 'caused_by', 'leads_to', 'depends_on', 'similar_to', 'part_of', 'example_of', 'derived_from'. Non-canonical values will be rejected. Set bidirectional=true for symmetric relations like 'related_to' and 'similar_to'.",
	schemas.addLink.shape,
	async (input) => {
		try {
			log.info("add_link", {
				from: input.fromNode,
				to: input.toNode,
				relation: input.relation,
			});
			const link = store.addLink(input);
			return {
				content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
			};
		} catch (e) {
			log.error("add_link failed", { error: (e as Error).message });
			throw e;
		}
	},
);

// update_link
server.tool(
	"update_link",
	"Update a link's relation, directionality, or confidence. The relation MUST be one of: 'related_to', 'contradicts', 'caused_by', 'leads_to', 'depends_on', 'similar_to', 'part_of', 'example_of', 'derived_from'. Use to correct relation names, mark links as bidirectional, or set confidence levels.",
	schemas.updateLink.shape,
	async (input) => {
		try {
			log.info("update_link", { linkId: input.linkId });
			const link = store.updateLink(input);
			return {
				content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
			};
		} catch (e) {
			log.error("update_link failed", { error: (e as Error).message });
			throw e;
		}
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	log.info("MCP server running", { graphPath });
}

main().catch((err) => {
	log.error("Fatal error", { error: err.message ?? String(err) });
	process.exit(1);
});
