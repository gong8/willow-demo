import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../../lib/graph-types.js";
import { MiniGraphCanvas } from "./MiniGraphCanvas.js";
import { extractSubgraph } from "./subgraph-extractors.js";
import type { SubgraphData } from "./types.js";
import { useGraphAnimation } from "./useGraphAnimation.js";

async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}

const DIMMED_NODE_COLOR = "#d1d5db";
const DIMMED_EDGE_COLOR = "#e5e7eb";

interface WillowToolVizProps {
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	isError?: boolean;
}

export function WillowToolViz({
	toolName,
	args,
	result,
	isError,
}: WillowToolVizProps) {
	const { data: graph } = useQuery<WillowGraph>({
		queryKey: ["graph"],
		queryFn: fetchGraph,
	});

	const subgraph = useMemo(() => {
		if (!graph) return null;
		return extractSubgraph(toolName, graph, args, result);
	}, [graph, toolName, args, result]);

	// Keep last valid subgraph so the graph never disappears once shown
	const subgraphRef = useRef<SubgraphData | null>(null);
	if (subgraph) {
		subgraphRef.current = subgraph;
	}
	const stableSubgraph = subgraph ?? subgraphRef.current;

	const phases = stableSubgraph?.phases ?? [];
	const animation = useGraphAnimation(phases);

	// Apply dimming: inactive nodes/edges are greyed out, active ones keep real colors
	const { displayNodes, displayEdges, selections } = useMemo(() => {
		if (!stableSubgraph) {
			return {
				displayNodes: [] as GraphNode[],
				displayEdges: [] as GraphEdge[],
				selections: [] as string[],
			};
		}

		const nodes: GraphNode[] = stableSubgraph.nodes.map((n) => ({
			...n,
			fill: animation.activeNodeIds.has(n.id) ? n.fill : DIMMED_NODE_COLOR,
		}));

		const edges: GraphEdge[] = stableSubgraph.edges.map((e) => ({
			...e,
			fill: animation.activeEdgeIds.has(e.id) ? e.fill : DIMMED_EDGE_COLOR,
		}));

		return {
			displayNodes: nodes,
			displayEdges: edges,
			selections: [...animation.selectedNodeIds],
		};
	}, [stableSubgraph, animation]);

	const shouldRender =
		!!stableSubgraph && stableSubgraph.nodes.length >= 2 && !isError;

	if (!shouldRender) {
		return null;
	}

	return (
		<div className="mt-1 min-h-[4px]">
			{/* Graph canvas — always render, no lazy loading */}
			<MiniGraphCanvas
				nodes={displayNodes}
				edges={displayEdges}
				selections={selections}
			/>
		</div>
	);
}
