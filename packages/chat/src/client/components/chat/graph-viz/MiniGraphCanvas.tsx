import { GraphCanvas } from "reagraph";
import type { GraphEdge, GraphNode } from "../../../lib/graph-types";

interface MiniGraphCanvasProps {
	nodes: GraphNode[];
	edges: GraphEdge[];
	selections: string[];
	height?: number;
	actives?: string[];
}

export function MiniGraphCanvas({
	nodes,
	edges,
	selections,
	height = 200,
	actives = [],
}: MiniGraphCanvasProps) {
	return (
		<div
			className="not-prose relative w-full rounded-lg border border-border bg-muted/30 overflow-hidden"
			style={{ height }}
		>
			<GraphCanvas
				nodes={nodes}
				edges={edges}
				layoutType="forceDirected2d"
				edgeArrowPosition="end"
				labelType="all"
				draggable={false}
				selections={selections}
				actives={actives}
			/>
		</div>
	);
}
