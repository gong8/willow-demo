#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JsGraphStore } from "@willow/core";
import { schemas } from "@willow/shared";
import { createLogger } from "./logger.js";

const log = createLogger("mcp");

const graphPath =
	process.env.WILLOW_GRAPH_PATH ?? join(homedir(), ".willow", "graph.json");

mkdirSync(join(graphPath, ".."), { recursive: true });

const store = JsGraphStore.open(graphPath);

const server = new McpServer({
	name: "willow",
	version: "0.1.0",
});

type ToolResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

function jsonResponse(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function textResponse(text: string, isError?: boolean): ToolResult {
	const result: ToolResult = { content: [{ type: "text", text }] };
	if (isError) result.isError = true;
	return result;
}

function registerTool(
	name: string,
	description: string,
	// biome-ignore lint/suspicious/noExplicitAny: schema types are validated by Zod at runtime
	schema: Record<string, any>,
	// biome-ignore lint/suspicious/noExplicitAny: input type is inferred from Zod schema at runtime
	fn: (input: any) => ToolResult,
) {
	server.tool(name, description, schema, async (input) => {
		try {
			log.info(name, input as Record<string, unknown>);
			return fn(input);
		} catch (e) {
			log.error(`${name} failed`, { error: (e as Error).message });
			throw e;
		}
	});
}

registerTool(
	"search_nodes",
	"Search the knowledge graph for nodes matching a query. Use this to find existing facts before creating new ones.",
	schemas.searchNodes.shape,
	({ query, maxResults }) => {
		const results = store.searchNodes(query, maxResults ?? 10);
		log.debug("search_nodes result", { count: results.length });
		return jsonResponse(results);
	},
);

registerTool(
	"get_context",
	"Get a node with its ancestors (path to root) and descendants (up to depth). Use this to understand where a fact sits in the knowledge tree.",
	schemas.getContext.shape,
	({ nodeId, depth }) => jsonResponse(store.getContext(nodeId, depth ?? 2)),
);

registerTool(
	"create_node",
	"Create a new node in the knowledge graph. Types: 'category' for top-level grouping, 'collection' for sub-groups, 'entity' for named things, 'attribute' for facts/properties, 'event' for time-bound occurrences, 'detail' for additional depth/elaboration. Always specify a parent node.",
	schemas.createNode.shape,
	(input) => jsonResponse(store.createNode(input)),
);

registerTool(
	"update_node",
	"Update an existing node's content or metadata. When content changes, the old value is preserved in history with an optional reason.",
	schemas.updateNode.shape,
	(input) => jsonResponse(store.updateNode(input)),
);

registerTool(
	"delete_node",
	"Delete a node and all its descendants from the knowledge graph. Cannot delete the root node. Associated links are also removed.",
	schemas.deleteNode.shape,
	({ nodeId }) => {
		store.deleteNode(nodeId);
		return textResponse(`Deleted node ${nodeId} and all descendants.`);
	},
);

function formatWalkView(targetId: string): ToolResult {
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
					content:
						gc.content.length > 80
							? `${gc.content.slice(0, 80)}...`
							: gc.content,
					type: gc.nodeType,
					childCount: gc.children.length,
				})),
		}));

	const links = ctx.links
		.filter((l) => l.fromNode === targetId || l.toNode === targetId)
		.map((l) => {
			const isOutgoing = l.fromNode === targetId;
			const otherNodeId = isOutgoing ? l.toNode : l.fromNode;
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

	return jsonResponse({ position, path, children, links });
}

function handleWalkAction(
	action: string,
	nodeId?: string,
	linkId?: string,
): ToolResult {
	if (action === "start") return formatWalkView("root");
	if (action === "done") return textResponse("Search complete.");

	if (action === "down") {
		if (!nodeId)
			return textResponse("Error: nodeId is required for 'down' action.", true);
		return formatWalkView(nodeId);
	}

	if (action === "up") {
		if (!nodeId)
			return textResponse("Error: nodeId is required for 'up' action.", true);
		const ctx = store.getContext(nodeId, 0);
		const parentId = ctx.node.parentId;
		if (!parentId) return textResponse("Already at root, cannot go up.");
		return formatWalkView(parentId);
	}

	if (action === "follow_link") {
		if (!nodeId || !linkId) {
			return textResponse(
				"Error: both nodeId and linkId are required for 'follow_link' action.",
				true,
			);
		}
		const ctx = store.getContext(nodeId, 0);
		const link = ctx.links.find((l) => l.id === linkId);
		if (!link) {
			return textResponse(
				`Error: link ${linkId} not found on node ${nodeId}.`,
				true,
			);
		}
		const isOutgoing = link.fromNode === nodeId;
		if (!isOutgoing && !link.bidirectional) {
			return textResponse(
				`Error: link ${linkId} is directed and cannot be followed from node ${nodeId} (it is incoming and not bidirectional).`,
				true,
			);
		}
		const targetNodeId = isOutgoing ? link.toNode : link.fromNode;
		return formatWalkView(targetNodeId);
	}

	return textResponse(`Unknown action: ${action}`, true);
}

registerTool(
	"walk_graph",
	"Navigate the knowledge tree one step at a time. Use 'start' to begin at root, 'down' to enter a child, 'up' to backtrack to parent, 'follow_link' to follow a cross-cutting link to its other endpoint, 'done' to end. Returns the current position, path from root, children, and cross-cutting links.",
	schemas.walkGraph.shape,
	({ action, nodeId, linkId }) => handleWalkAction(action, nodeId, linkId),
);

registerTool(
	"delete_link",
	"Delete a link between two nodes by its link ID.",
	schemas.deleteLink.shape,
	({ linkId }) => jsonResponse(store.deleteLink(linkId)),
);

registerTool(
	"add_link",
	"Create a link between two nodes. The relation MUST be one of: 'related_to', 'contradicts', 'caused_by', 'leads_to', 'depends_on', 'similar_to', 'part_of', 'example_of', 'derived_from'. Non-canonical values will be rejected. Set bidirectional=true for symmetric relations like 'related_to' and 'similar_to'.",
	schemas.addLink.shape,
	(input) => jsonResponse(store.addLink(input)),
);

registerTool(
	"update_link",
	"Update a link's relation, directionality, or confidence. The relation MUST be one of: 'related_to', 'contradicts', 'caused_by', 'leads_to', 'depends_on', 'similar_to', 'part_of', 'example_of', 'derived_from'. Use to correct relation names, mark links as bidirectional, or set confidence levels.",
	schemas.updateLink.shape,
	(input) => jsonResponse(store.updateLink(input)),
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
