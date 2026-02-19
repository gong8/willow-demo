import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

interface SearchToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
}

function SearchToolCallViz({ tc }: { tc: SearchToolCall }) {
	return (
		<WillowToolViz
			toolName={tc.toolName}
			args={tc.args}
			result={tc.result}
			isError={tc.isError}
		/>
	);
}

export function SearchIndicator({
	toolCalls,
}: {
	toolCalls: SearchToolCall[];
}) {
	const [collapsed, setCollapsed] = useState(false);

	// Search is still in progress if any tool call is pending (no result yet)
	const isSearching = toolCalls.some((tc) => tc.result === undefined);

	return (
		<div
			className={`my-1.5 rounded-lg border border-border bg-background text-sm transition-opacity ${
				!isSearching ? "opacity-80" : "opacity-100"
			}`}
		>
			<button
				type="button"
				onClick={() => setCollapsed(!collapsed)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-lg"
			>
				{isSearching ? (
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
				) : (
					<Search className="h-3.5 w-3.5 shrink-0 text-blue-500" />
				)}
				<span className="flex-1 text-muted-foreground">
					{isSearching ? "Searching memory..." : "Memory searched"}
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
						<SearchToolCallViz key={tc.toolCallId} tc={tc} />
					))}
				</div>
			)}
		</div>
	);
}
