import { GraphCanvas } from "reagraph";
import type { GraphEdge, GraphNode } from "../../../lib/graph-types.js";

interface MiniGraphCanvasProps {
	nodes: GraphNode[];
	edges: GraphEdge[];
	actives: string[];
	selections: string[];
}

export function MiniGraphCanvas({
	nodes,
	edges,
	actives,
	selections,
}: MiniGraphCanvasProps) {
	return (
		<div className="not-prose relative h-[200px] w-full rounded-lg border border-border bg-muted/30 overflow-hidden">
			<GraphCanvas
				nodes={nodes}
				edges={edges}
				layoutType="forceDirected2d"
				edgeArrowPosition="end"
				labelType="all"
				draggable={false}
				actives={actives}
				selections={selections}
			/>
		</div>
	);
}
