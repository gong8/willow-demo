import { GraphCanvas } from "reagraph";
import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../lib/graph-types.js";
import { NodeDetailPanel } from "../graph/NodeDetailPanel.js";
import { useGraphSelection } from "./useGraphSelection.js";

export function GraphPreviewShell({
	nodes,
	edges,
	graph,
	emptyMessage,
	header,
}: {
	nodes: GraphNode[];
	edges: GraphEdge[];
	graph: WillowGraph;
	emptyMessage: string;
	header?: React.ReactNode;
}) {
	const { selectedNodeId, selections, handleNodeClick, handleCanvasClick } =
		useGraphSelection();

	const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;

	if (nodes.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{header}
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
