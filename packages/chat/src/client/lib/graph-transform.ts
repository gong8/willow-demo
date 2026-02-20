import type {
	GraphEdge,
	GraphNode,
	GraphStats,
	NodeType,
	WillowGraph,
} from "./graph-types.js";

// ---------- Colors & sizes ----------

export const NODE_COLORS: Record<NodeType, string> = {
	root: "#6366f1",
	category: "#8b5cf6",
	collection: "#a78bfa",
	entity: "#f59e0b",
	attribute: "#06b6d4",
	event: "#22c55e",
	detail: "#94a3b8",
};

export const NODE_SIZES: Record<NodeType, number> = {
	root: 12,
	category: 8,
	collection: 7,
	entity: 6,
	attribute: 5,
	event: 5,
	detail: 3,
};

export const LINK_COLORS: Record<string, string> = {
	related_to: "#f59e0b",
	contradicts: "#ef4444",
	caused_by: "#22c55e",
};
export const DEFAULT_LINK_COLOR = "#a78bfa";

export const TREE_EDGE_COLOR = "#94a3b8";

// ---------- Transform ----------

export interface TransformOptions {
	enabledTypes: Set<NodeType>;
	searchQuery: string;
}

export interface TransformResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
	stats: GraphStats;
}

export function transformGraphData(
	graph: WillowGraph,
	options: TransformOptions,
): TransformResult {
	const { enabledTypes, searchQuery } = options;
	const query = searchQuery.toLowerCase();

	// 1. Build visible node set
	const visibleIds = new Set<string>();
	const nodes: GraphNode[] = [];

	for (const [id, node] of Object.entries(graph.nodes)) {
		if (!enabledTypes.has(node.node_type)) continue;
		if (query && !node.content.toLowerCase().includes(query)) continue;

		visibleIds.add(id);
		nodes.push({
			id,
			label:
				node.content.length > 40
					? `${node.content.slice(0, 40)}...`
					: node.content,
			fill: NODE_COLORS[node.node_type] ?? NODE_COLORS.detail,
			size: NODE_SIZES[node.node_type] ?? NODE_SIZES.detail,
		});
	}

	// 2. Tree edges (parent → child)
	const edges: GraphEdge[] = [];
	let treeEdgeCount = 0;

	for (const id of visibleIds) {
		const node = graph.nodes[id];
		if (node.parent_id && visibleIds.has(node.parent_id)) {
			edges.push({
				id: `tree__${node.parent_id}__${id}`,
				source: node.parent_id,
				target: id,
				size: 1,
				fill: TREE_EDGE_COLOR,
			});
			treeEdgeCount++;
		}
	}

	// 3. Cross-link edges
	const relationTypes = new Set<string>();
	let linkCount = 0;

	for (const link of Object.values(graph.links)) {
		if (!visibleIds.has(link.from_node) || !visibleIds.has(link.to_node))
			continue;

		relationTypes.add(link.relation);
		linkCount++;
		edges.push({
			id: `link__${link.id}`,
			source: link.from_node,
			target: link.to_node,
			label: link.relation,
			size: 2,
			fill: LINK_COLORS[link.relation] ?? DEFAULT_LINK_COLOR,
		});
	}

	// 4. Stats
	const nodesByType: Record<string, number> = {};
	for (const node of Object.values(graph.nodes)) {
		nodesByType[node.node_type] = (nodesByType[node.node_type] ?? 0) + 1;
	}

	return {
		nodes,
		edges,
		stats: {
			nodeCount: nodes.length,
			linkCount,
			treeEdgeCount,
			nodesByType,
			relationTypes: [...relationTypes],
		},
	};
}
