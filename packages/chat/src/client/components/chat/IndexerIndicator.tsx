import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Loader2,
} from "lucide-react";
import { useMemo, useEffect, useRef, useState } from "react";
import type { IndexerResultsPart } from "../../lib/chat-adapter.js";
import { getToolLabel } from "./ToolCallDisplay.js";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

const SEARCH_TOOLS = new Set([
	"mcp__willow__search_nodes",
	"mcp__willow__get_context",
]);

function IndexerToolCall({
	tc,
}: {
	tc: IndexerResultsPart["toolCalls"][number];
}) {
	return (
		<WillowToolViz
			toolName={tc.toolName}
			args={tc.args}
			result={tc.result}
			isError={tc.isError}
		/>
	);
}

export function IndexerIndicator({ part }: { part: IndexerResultsPart }) {
	const [collapsed, setCollapsed] = useState(false);
	const [currentIndex, setCurrentIndex] = useState(0);

	// Only show mutation tool calls (exclude searches)
	const updateCalls = useMemo(
		() => part.toolCalls.filter((tc) => !SEARCH_TOOLS.has(tc.toolName)),
		[part.toolCalls],
	);

	const prevLengthRef = useRef(updateCalls.length);

	const isRunning = part.indexerStatus === "running";
	const total = updateCalls.length;

	// Auto-advance to latest tool call as new ones stream in
	useEffect(() => {
		if (updateCalls.length > prevLengthRef.current) {
			setCurrentIndex(updateCalls.length - 1);
		}
		prevLengthRef.current = updateCalls.length;
	}, [updateCalls.length]);

	// Hide entirely when the indexer made no mutations (nothing to store)
	if (total === 0 && !isRunning) return null;

	// Clamp index if array shrinks
	const safeIndex = Math.min(currentIndex, Math.max(0, total - 1));
	const currentTc = updateCalls[safeIndex];

	// While running but no mutations yet, don't show anything
	if (total === 0) return null;

	return (
		<div
			className={`my-1.5 rounded-lg border border-border bg-background text-sm transition-opacity ${
				!isRunning ? "opacity-80" : "opacity-100"
			}`}
		>
			<button
				type="button"
				onClick={() => setCollapsed(!collapsed)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-lg"
			>
				{isRunning ? (
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" />
				) : (
					<Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
				)}
				<span className="flex-1 text-muted-foreground">
					{isRunning ? "Updating memory..." : "Memory updated"}
				</span>
				{collapsed ? (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				)}
			</button>
			{!collapsed && total > 0 && currentTc && (
				<div className="border-t border-border px-3 py-2">
					<IndexerToolCall tc={currentTc} />
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
				</div>
			)}
		</div>
	);
}
