import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WillowGraph } from "../../../lib/graph-types.js";
import { MiniGraphCanvas } from "./MiniGraphCanvas.js";
import { extractSubgraph } from "./subgraph-extractors.js";
import { useGraphAnimation } from "./useGraphAnimation.js";

async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}

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

	const phases = subgraph?.phases ?? [];
	const animation = useGraphAnimation(phases);

	// IntersectionObserver to only mount canvas when visible (WebGL context limit)
	const containerRef = useRef<HTMLDivElement>(null);
	const [isVisible, setIsVisible] = useState(false);

	const shouldRender =
		!!graph && !!subgraph && subgraph.nodes.length >= 2 && !isError;

	useEffect(() => {
		if (!shouldRender) return;
		const el = containerRef.current;
		if (!el) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setIsVisible(true);
					observer.disconnect();
				}
			},
			{ threshold: 0 },
		);

		observer.observe(el);
		return () => observer.disconnect();
	}, [shouldRender]);

	if (!shouldRender) {
		return null;
	}

	const actives = [...animation.activeNodeIds, ...animation.activeEdgeIds];

	return (
		<div ref={containerRef} className="mt-1 min-h-[4px]">
			{isVisible && (
				<MiniGraphCanvas
					nodes={subgraph.nodes}
					edges={subgraph.edges}
					actives={actives}
					selections={animation.selectedNodeIds}
				/>
			)}
		</div>
	);
}
