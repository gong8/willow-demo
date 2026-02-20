import type {
	GraphEdge,
	GraphNode,
	GraphStats,
	NodeType,
	WillowGraph,
} from "./graph-types";

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
	leads_to: "#3b82f6",
	depends_on: "#f97316",
	similar_to: "#eab308",
	part_of: "#8b5cf6",
	example_of: "#14b8a6",
	derived_from: "#ec4899",
};
export const DEFAULT_LINK_COLOR = "#a78bfa";

export const TREE_EDGE_COLOR = "#94a3b8";

// ---------- Transform ----------

export interface TransformOptions {
	enabledTypes: Set<NodeType>;
	enabledRelations?: Set<string>;
	searchQuery: string;
}

export interface TransformResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
	stats: GraphStats;
}

function increment(record: Record<string, number>, key: string) {
	record[key] = (record[key] ?? 0) + 1;
}

function truncate(text: string, max: number) {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function transformGraphData(
	graph: WillowGraph,
	options: TransformOptions,
): TransformResult {
	const { enabledTypes, enabledRelations, searchQuery } = options;
	const query = searchQuery.toLowerCase();

	const visibleIds = new Set<string>();
	const nodes: GraphNode[] = [];
	const nodesByType: Record<string, number> = {};

	for (const [id, node] of Object.entries(graph.nodes)) {
		increment(nodesByType, node.node_type);

		if (!enabledTypes.has(node.node_type)) continue;
		if (query && !node.content.toLowerCase().includes(query)) continue;

		visibleIds.add(id);
		nodes.push({
			id,
			label: truncate(node.content, 40),
			fill: NODE_COLORS[node.node_type] ?? NODE_COLORS.detail,
			size: NODE_SIZES[node.node_type] ?? NODE_SIZES.detail,
		});
	}

	const edges: GraphEdge[] = [];
	let treeEdgeCount = 0;

	for (const id of visibleIds) {
		const { parent_id } = graph.nodes[id];
		if (parent_id && visibleIds.has(parent_id)) {
			edges.push({
				id: `tree__${parent_id}__${id}`,
				source: parent_id,
				target: id,
				size: 1,
				fill: TREE_EDGE_COLOR,
			});
			treeEdgeCount++;
		}
	}

	const relationTypes = new Set<string>();
	const linksByRelation: Record<string, number> = {};
	let linkCount = 0;

	for (const link of Object.values(graph.links)) {
		increment(linksByRelation, link.relation);
		relationTypes.add(link.relation);

		if (!visibleIds.has(link.from_node) || !visibleIds.has(link.to_node))
			continue;
		if (enabledRelations && !enabledRelations.has(link.relation)) continue;

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

	return {
		nodes,
		edges,
		stats: {
			nodeCount: nodes.length,
			linkCount,
			treeEdgeCount,
			nodesByType,
			relationTypes: [...relationTypes],
			linksByRelation,
		},
	};
}
