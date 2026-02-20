import { MiniGraphCanvas } from "./MiniGraphCanvas";
import type { SearchToolCall } from "./types";
import {
	type WalkStep,
	useCumulativeSearchGraph,
} from "./useCumulativeSearchGraph";

function formatStepLabel(step: WalkStep): string {
	if (step.action === "start") return "Root";
	if (step.action === "done") return "\u2713";
	if (step.action === "up") return "\u2191";
	if (step.positionContent)
		return step.positionContent.length > 16
			? `${step.positionContent.slice(0, 14)}\u2026`
			: step.positionContent;
	return step.status === "pending" ? "\u2026" : "...";
}

function StepIndicator({
	step,
	isActive,
}: {
	step: WalkStep;
	isActive: boolean;
}) {
	const dotColor =
		step.status === "settled"
			? isActive
				? "bg-blue-500"
				: "bg-muted-foreground/50"
			: "bg-blue-400 animate-pulse";

	return (
		<span
			className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
				isActive
					? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
					: "bg-muted text-muted-foreground"
			}`}
		>
			<span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
			{formatStepLabel(step)}
		</span>
	);
}

export function SearchGraphViz({
	toolCalls,
}: {
	toolCalls: SearchToolCall[];
}) {
	const { nodes, edges, selections, actives, steps, activeStepIndex } =
		useCumulativeSearchGraph(toolCalls);

	if (nodes.length < 2) return null;

	return (
		<div className="mt-1 space-y-1.5">
			{steps.length > 1 && (
				<div className="flex items-center gap-0.5 px-1 overflow-x-auto">
					{steps.map((step, i) => (
						<div key={step.toolCallId} className="flex items-center">
							<StepIndicator step={step} isActive={i === activeStepIndex} />
							{i < steps.length - 1 && (
								<span className="text-muted-foreground/40 text-xs mx-0.5">
									{"\u203A"}
								</span>
							)}
						</div>
					))}
				</div>
			)}

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
