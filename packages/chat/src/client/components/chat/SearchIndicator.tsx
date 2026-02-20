import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { SearchGraphViz } from "./graph-viz/SearchGraphViz.js";

interface SearchToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

export function SearchIndicator({
	toolCalls,
	searchStatus,
}: {
	toolCalls: SearchToolCall[];
	searchStatus: "searching" | "done";
}) {
	const [collapsed, setCollapsed] = useState(false);

	const isSearching = searchStatus !== "done";

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
				<div className="border-t border-border px-3 py-2">
					<SearchGraphViz toolCalls={toolCalls} />
				</div>
			)}
		</div>
	);
}
