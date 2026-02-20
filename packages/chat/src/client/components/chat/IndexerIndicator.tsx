import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IndexerResultsPart } from "../../lib/chat-adapter.js";
import { StatusIndicator } from "./StatusIndicator.js";
import { getToolLabel } from "./ToolCallDisplay.js";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

const SEARCH_TOOLS = new Set([
	"mcp__willow__search_nodes",
	"mcp__willow__get_context",
]);

export function IndexerIndicator({
	part,
	collapsible = true,
}: { part: IndexerResultsPart; collapsible?: boolean }) {
	const [currentIndex, setCurrentIndex] = useState(0);

	const updateCalls = useMemo(
		() => part.toolCalls.filter((tc) => !SEARCH_TOOLS.has(tc.toolName)),
		[part.toolCalls],
	);

	const prevLengthRef = useRef(updateCalls.length);

	const isRunning = part.indexerStatus === "running";
	const total = updateCalls.length;

	useEffect(() => {
		if (updateCalls.length > prevLengthRef.current) {
			setCurrentIndex(updateCalls.length - 1);
		}
		prevLengthRef.current = updateCalls.length;
	}, [updateCalls.length]);

	if (total === 0) return null;

	const safeIndex = Math.min(currentIndex, Math.max(0, total - 1));
	const currentTc = updateCalls[safeIndex];

	return (
		<StatusIndicator
			isActive={isRunning}
			activeLabel="Updating memory..."
			doneLabel="Memory updated"
			doneIcon={Check}
			iconColor={isRunning ? "text-violet-500" : "text-green-600"}
			collapsible={collapsible}
		>
			{currentTc && (
				<>
					<WillowToolViz
						toolName={currentTc.toolName}
						args={currentTc.args}
						result={currentTc.result}
						isError={currentTc.isError}
					/>
					{total > 1 && (
						<div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
							<button
								type="button"
								onClick={() => setCurrentIndex(safeIndex - 1)}
								disabled={safeIndex === 0}
								className="p-0.5 rounded hover:bg-accent/50 disabled:opacity-30 disabled:cursor-default"
							>
								<ChevronLeft className="h-3.5 w-3.5" />
							</button>
							<span className="flex-1 truncate text-center">
								{getToolLabel(currentTc.toolName, currentTc.args)}
							</span>
							<span className="shrink-0 tabular-nums">
								{safeIndex + 1} / {total}
							</span>
							<button
								type="button"
								onClick={() => setCurrentIndex(safeIndex + 1)}
								disabled={safeIndex >= total - 1}
								className="p-0.5 rounded hover:bg-accent/50 disabled:opacity-30 disabled:cursor-default"
							>
								<ChevronRight className="h-3.5 w-3.5" />
							</button>
						</div>
					)}
				</>
			)}
		</StatusIndicator>
	);
}
