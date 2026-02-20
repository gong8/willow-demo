import { useEffect, useRef, useState } from "react";
import { MiniGraphCanvas } from "./MiniGraphCanvas.js";
import { useCumulativeSearchGraph } from "./useCumulativeSearchGraph.js";

interface SearchToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
}

const TOOL_PREFIX = "mcp__willow__";

function formatToolLabel(
	toolName: string,
	args: Record<string, unknown>,
): string {
	const name = toolName.startsWith(TOOL_PREFIX)
		? toolName.slice(TOOL_PREFIX.length)
		: toolName;

	if (name === "search_nodes") {
		const query = args.query as string | undefined;
		return query
			? `search: "${query.length > 20 ? `${query.slice(0, 20)}...` : query}"`
			: "search";
	}
	if (name === "get_context") {
		const nodeId = args.nodeId as string | undefined;
		return nodeId ? `context: ${nodeId.slice(0, 8)}` : "context";
	}
	return name;
}

export function SearchGraphViz({
	toolCalls,
}: {
	toolCalls: SearchToolCall[];
}) {
	const {
		nodes,
		edges,
		selections,
		actives,
		layers,
		activeLayerIndex,
		setActiveLayerIndex,
	} = useCumulativeSearchGraph(toolCalls);

	// IntersectionObserver for lazy WebGL loading
	const containerRef = useRef<HTMLDivElement>(null);
	const [isVisible, setIsVisible] = useState(false);

	const shouldRender = nodes.length >= 2;

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

	return (
		<div ref={containerRef} className="mt-1 space-y-1.5">
			{/* Timeline strip */}
			{layers.length > 1 && (
				<div className="flex items-center gap-1.5 px-1 overflow-x-auto">
					{layers.map((layer, i) => {
						const tc = toolCalls.find((t) => t.toolCallId === layer.toolCallId);
						const label = tc
							? formatToolLabel(tc.toolName, tc.args)
							: layer.toolName;
						const isActive = i === activeLayerIndex;

						return (
							<button
								key={layer.toolCallId}
								type="button"
								onClick={() => setActiveLayerIndex(i)}
								className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap transition-colors ${
									isActive
										? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
										: "bg-muted text-muted-foreground hover:bg-accent"
								}`}
							>
								<span
									className={`inline-block h-1.5 w-1.5 rounded-full ${
										layer.status === "settled"
											? isActive
												? "bg-blue-500"
												: "bg-muted-foreground/50"
											: "bg-blue-400 animate-pulse"
									}`}
								/>
								{label}
							</button>
						);
					})}
				</div>
			)}

			{/* Single canvas */}
			{isVisible && (
				<MiniGraphCanvas
					nodes={nodes}
					edges={edges}
					selections={selections}
					actives={actives}
					height={240}
				/>
			)}
		</div>
	);
}
