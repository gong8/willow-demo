import { useCallback, useEffect, useMemo, useState } from "react";
import { transformGraphData } from "../../lib/graph-transform";
import type {
	GraphStats,
	LayoutType,
	NodeType,
	WillowGraph,
} from "../../lib/graph-types";

function toggleSetItem<T>(set: Set<T>, item: T): Set<T> {
	const next = new Set(set);
	if (next.has(item)) {
		next.delete(item);
	} else {
		next.add(item);
	}
	return next;
}

const ALL_NODE_TYPES: Set<NodeType> = new Set([
	"root",
	"category",
	"collection",
	"entity",
	"attribute",
	"event",
	"detail",
]);

const EMPTY_STATS: GraphStats = {
	nodeCount: 0,
	linkCount: 0,
	treeEdgeCount: 0,
	nodesByType: {},
	relationTypes: [],
	linksByRelation: {},
};

export function useGraphFilters(graph: WillowGraph | undefined) {
	const [searchQuery, setSearchQuery] = useState("");
	const [layout, setLayout] = useState<LayoutType>("forceDirected2d");
	const [enabledTypes, setEnabledTypes] = useState<Set<NodeType>>(
		() => new Set(ALL_NODE_TYPES),
	);
	const [enabledRelations, setEnabledRelations] = useState<Set<string>>(
		() => new Set(),
	);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selections, setSelections] = useState<string[]>([]);

	const toggleType = useCallback((type: NodeType) => {
		setEnabledTypes((prev) => toggleSetItem(prev, type));
	}, []);

	const toggleRelation = useCallback((relation: string) => {
		setEnabledRelations((prev) => toggleSetItem(prev, relation));
	}, []);

	const selectNode = useCallback((id: string) => {
		setSelectedNodeId(id);
		setSelections([id]);
	}, []);

	const clearSelection = useCallback(() => {
		setSelectedNodeId(null);
		setSelections([]);
	}, []);

	const { nodes, edges, stats } = useMemo(() => {
		if (!graph) return { nodes: [], edges: [], stats: EMPTY_STATS };
		return transformGraphData(graph, {
			enabledTypes,
			enabledRelations,
			searchQuery,
		});
	}, [graph, enabledTypes, enabledRelations, searchQuery]);

	// Auto-enable newly discovered relation types
	useEffect(() => {
		if (stats.relationTypes.length === 0) return;
		setEnabledRelations((prev) => {
			const next = new Set(prev);
			let changed = false;
			for (const rt of stats.relationTypes) {
				if (!next.has(rt)) {
					next.add(rt);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [stats.relationTypes]);

	const selectedNode =
		selectedNodeId && graph ? graph.nodes[selectedNodeId] : null;

	return {
		searchQuery,
		setSearchQuery,
		layout,
		setLayout,
		enabledTypes,
		toggleType,
		enabledRelations,
		toggleRelation,
		selectedNodeId,
		selectedNode,
		selections,
		selectNode,
		clearSelection,
		nodes,
		edges,
		stats,
	};
}
