import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import type { WillowGraph } from "../../../lib/graph-types";
import { MiniGraphCanvas } from "./MiniGraphCanvas";
import { extractSubgraph } from "./subgraph-extractors";
import { type SubgraphData, fetchGraph } from "./types";
import { useGraphAnimation } from "./useGraphAnimation";

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

	const subgraph = useMemo(
		() => (graph ? extractSubgraph(toolName, graph, args, result) : null),
		[graph, toolName, args, result],
	);

	// Keep the last valid subgraph visible during refetches
	const subgraphRef = useRef<SubgraphData | null>(null);
	if (subgraph) subgraphRef.current = subgraph;
	const stable = subgraph ?? subgraphRef.current;

	const animation = useGraphAnimation(stable?.phases ?? []);

	if (!stable || stable.nodes.length < 2 || isError) return null;

	const displayNodes = stable.nodes.map((n) => ({
		...n,
		fill: animation.activeNodeIds.has(n.id) ? n.fill : DIMMED_NODE_COLOR,
	}));
	const displayEdges = stable.edges.map((e) => ({
		...e,
		fill: animation.activeEdgeIds.has(e.id) ? e.fill : DIMMED_EDGE_COLOR,
	}));

	return (
		<div className="mt-1 min-h-[4px]">
			<MiniGraphCanvas
				nodes={displayNodes}
				edges={displayEdges}
				selections={[...animation.selectedNodeIds]}
			/>
		</div>
	);
}
