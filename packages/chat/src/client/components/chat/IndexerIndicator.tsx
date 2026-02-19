import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useIndexerStatus } from "../../hooks/useIndexerStatus.js";
import type { ToolCallData } from "../../lib/api.js";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

function IndexerToolCall({ tc }: { tc: ToolCallData }) {
	return (
		<div className="pl-4">
			<WillowToolViz
				toolName={tc.toolName}
				args={tc.args}
				result={tc.result}
				isError={tc.isError}
			/>
		</div>
	);
}

export function IndexerIndicator({
	conversationId,
}: {
	conversationId: string;
}) {
	const { active, status, toolCalls } = useIndexerStatus(conversationId);
	const [collapsed, setCollapsed] = useState(false);
	const [visible, setVisible] = useState(false);

	// Show when running, fade out after complete
	useEffect(() => {
		if (status === "running") {
			setVisible(true);
		} else if (status === "complete") {
			const timer = setTimeout(() => setVisible(false), 3000);
			return () => clearTimeout(timer);
		} else if (!status) {
			setVisible(false);
		}
	}, [status]);

	if (!visible) return null;

	const isRunning = active && status === "running";
	const isComplete = status === "complete";

	return (
		<div
			className={`mx-4 mb-2 rounded-lg border border-border bg-background text-sm transition-opacity ${
				isComplete ? "opacity-60" : "opacity-100"
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
			{!collapsed && toolCalls.length > 0 && (
				<div className="border-t border-border px-3 py-2 space-y-1">
					{toolCalls.map((tc) => (
						<IndexerToolCall key={tc.toolCallId} tc={tc} />
					))}
				</div>
			)}
		</div>
	);
}
