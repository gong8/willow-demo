import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { GraphCanvas } from "reagraph";
import { fetchGraphAtCommit } from "../../lib/api.js";
import { transformGraphData } from "../../lib/graph-transform.js";
import type { NodeType, WillowGraph } from "../../lib/graph-types.js";
import { NodeDetailPanel } from "../graph/NodeDetailPanel.js";
import { useGraphSelection } from "./useGraphSelection.js";

const ALL_TYPES = new Set<NodeType>([
	"root",
	"category",
	"collection",
	"entity",
	"attribute",
	"event",
	"detail",
]);

export function SnapshotGraphPreview({ hash }: { hash: string }) {
	const { data: graph, isLoading } = useQuery<WillowGraph>({
		queryKey: ["graph-at-commit", hash],
		queryFn: () => fetchGraphAtCommit(hash),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const { selectedNodeId, selections, handleNodeClick, handleCanvasClick } =
		useGraphSelection();

	const { nodes, edges, stats } = useMemo(() => {
		if (!graph) {
			return {
				nodes: [],
				edges: [],
				stats: {
					nodeCount: 0,
					linkCount: 0,
					treeEdgeCount: 0,
					nodesByType: {},
					relationTypes: [],
				},
			};
		}
		return transformGraphData(graph, {
			enabledTypes: ALL_TYPES,
			searchQuery: "",
		});
	}, [graph]);

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				Loading graph snapshot...
			</div>
		);
	}

	if (!graph || nodes.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				No graph data at this commit.
			</div>
		);
	}

	const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
				<span>{stats.nodeCount} nodes</span>
				<span>{stats.treeEdgeCount} edges</span>
				{stats.linkCount > 0 && <span>{stats.linkCount} links</span>}
			</div>
			<div className="flex flex-1 overflow-hidden">
				<div className="relative flex-1">
					<GraphCanvas
						nodes={nodes}
						edges={edges}
						layoutType="forceDirected2d"
						edgeArrowPosition="end"
						labelType="all"
						draggable
						selections={selections}
						onNodeClick={handleNodeClick}
						onCanvasClick={handleCanvasClick}
					/>
				</div>
				{selectedNode && (
					<NodeDetailPanel
						node={selectedNode}
						graph={graph}
						onClose={handleCanvasClick}
					/>
				)}
			</div>
		</div>
	);
}
