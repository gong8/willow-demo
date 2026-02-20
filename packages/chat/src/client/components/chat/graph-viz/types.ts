import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../../lib/graph-types.js";

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

export interface SearchLayer {
	toolCallId: string;
	toolName: string;
	nodeIds: Set<string>;
	focusNodeIds: string[];
	status: "pending" | "animating" | "settled";
}

export interface SearchToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
}

export async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}
