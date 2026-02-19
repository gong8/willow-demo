import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	Loader2,
} from "lucide-react";
import { useState } from "react";

const TOOL_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
	mcp__willow__search_nodes: (a) => `Searched memory for "${a.query ?? ""}"`,
	mcp__willow__get_context: (a) =>
		`Viewed context for node ${(a.nodeId as string)?.slice(0, 8) ?? ""}`,
	mcp__willow__create_node: (a) =>
		`Stored: "${(a.content as string)?.slice(0, 40) ?? ""}"`,
	mcp__willow__update_node: () => "Updated memory",
	mcp__willow__delete_node: () => "Deleted from memory",
	mcp__willow__add_link: (a) => `Linked: ${a.relation ?? "related"}`,
};

export function getToolLabel(
	toolName: string,
	args: Record<string, unknown>,
): string {
	const fn = TOOL_LABELS[toolName];
	if (fn) return fn(args);
	const short = toolName.replace(/^mcp__\w+__/, "");
	return short.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ToolCallDisplay(props: ToolCallMessagePartProps) {
	const { toolName, args, result, isError } = props;
	const [expanded, setExpanded] = useState(false);
	const hasResult = result !== undefined;
	const label = getToolLabel(toolName, args);

	return (
		<div className="my-1.5 rounded-lg border border-border bg-background text-sm">
			<button
				type="button"
				onClick={() => hasResult && setExpanded(!expanded)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-lg"
				disabled={!hasResult}
			>
				{isError ? (
					<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
				) : hasResult ? (
					<Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
				) : (
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
				)}
				<span
					className={`flex-1 truncate ${isError ? "text-destructive" : "text-muted-foreground"}`}
				>
					{hasResult ? label : `${label}...`}
				</span>
				{hasResult &&
					(expanded ? (
						<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					))}
			</button>
			{expanded && hasResult && (
				<div className="border-t border-border px-3 py-2">
					<pre className="max-h-48 overflow-auto text-xs text-muted-foreground whitespace-pre-wrap break-all">
						{typeof result === "string"
							? result
							: JSON.stringify(result, null, 2)}
					</pre>
				</div>
			)}
		</div>
	);
}
