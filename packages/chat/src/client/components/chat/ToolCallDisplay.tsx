import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { CollapsiblePanel } from "./CollapsiblePanel";

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

export function ToolCallStatusIcon({
	isError,
	hasResult,
}: { isError?: boolean; hasResult: boolean }) {
	if (isError)
		return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
	if (hasResult)
		return <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />;
	return (
		<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
	);
}

export function ToolCallDisplay(props: ToolCallMessagePartProps) {
	const { toolName, args, result, isError } = props;
	const hasResult = result !== undefined;
	const label = getToolLabel(toolName, args);

	return (
		<CollapsiblePanel
			className="bg-background"
			disabled={!hasResult}
			header={
				<>
					<ToolCallStatusIcon isError={isError} hasResult={hasResult} />
					<span
						className={`flex-1 truncate ${isError ? "text-destructive" : "text-muted-foreground"}`}
					>
						{hasResult ? label : `${label}...`}
					</span>
				</>
			}
		>
			<pre className="max-h-48 overflow-auto text-xs text-muted-foreground whitespace-pre-wrap break-all">
				{typeof result === "string" ? result : JSON.stringify(result, null, 2)}
			</pre>
		</CollapsiblePanel>
	);
}
