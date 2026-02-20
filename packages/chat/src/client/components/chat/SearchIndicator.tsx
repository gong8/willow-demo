import { Search } from "lucide-react";
import { StatusIndicator } from "./StatusIndicator.js";
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
	collapsible = true,
}: {
	toolCalls: SearchToolCall[];
	searchStatus: "searching" | "done";
	collapsible?: boolean;
}) {
	return (
		<StatusIndicator
			isActive={searchStatus !== "done"}
			activeLabel="Searching memory..."
			doneLabel="Memory searched"
			doneIcon={Search}
			iconColor="text-blue-500"
			collapsible={collapsible}
		>
			{toolCalls.length > 0 && <SearchGraphViz toolCalls={toolCalls} />}
		</StatusIndicator>
	);
}
