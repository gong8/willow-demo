import { MiniGraphCanvas } from "./MiniGraphCanvas.js";
import type { SearchToolCall } from "./types.js";
import {
	type WalkStep,
	useCumulativeSearchGraph,
} from "./useCumulativeSearchGraph.js";

function formatStepLabel(step: WalkStep): string {
	if (step.action === "start") return "Root";
	if (step.action === "done") return "\u2713";
	if (step.action === "up") return "\u2191";
	if (step.positionContent) {
		const text = step.positionContent;
		return text.length > 16 ? `${text.slice(0, 14)}\u2026` : text;
	}
	if (step.status === "pending") return "\u2026";
	return "...";
}

export function SearchGraphViz({
	toolCalls,
}: {
	toolCalls: SearchToolCall[];
}) {
	const { nodes, edges, selections, actives, steps, activeStepIndex } =
		useCumulativeSearchGraph(toolCalls);

	if (nodes.length < 2) {
		return null;
	}

	return (
		<div className="mt-1 space-y-1.5">
			{/* Timeline strip */}
			{steps.length > 1 && (
				<div className="flex items-center gap-0.5 px-1 overflow-x-auto">
					{steps.map((step, i) => {
						const label = formatStepLabel(step);
						const isActive = i === activeStepIndex;
						const isLast = i === steps.length - 1;

						return (
							<div key={step.toolCallId} className="flex items-center">
								<span
									className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
										isActive
											? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
											: "bg-muted text-muted-foreground"
									}`}
								>
									<span
										className={`inline-block h-1.5 w-1.5 rounded-full ${
											step.status === "settled"
												? isActive
													? "bg-blue-500"
													: "bg-muted-foreground/50"
												: "bg-blue-400 animate-pulse"
										}`}
									/>
									{label}
								</span>
								{!isLast && (
									<span className="text-muted-foreground/40 text-xs mx-0.5">
										{"\u203A"}
									</span>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Graph canvas — always render, no lazy loading */}
			<MiniGraphCanvas
				nodes={nodes}
				edges={edges}
				selections={selections}
				actives={actives}
				height={240}
			/>
		</div>
	);
}
