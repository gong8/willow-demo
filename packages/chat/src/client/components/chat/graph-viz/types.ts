import type { GraphEdge, GraphNode } from "../../../lib/graph-types.js";

export interface AnimationPhase {
	activeNodeIds: string[];
	activeEdgeIds: string[];
	selectedNodeIds: string[];
}

export interface SubgraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	phases: AnimationPhase[];
	focusNodeIds: string[];
}
