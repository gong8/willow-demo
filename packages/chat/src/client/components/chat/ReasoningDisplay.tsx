import { CollapsiblePanel } from "./CollapsiblePanel";

export function ReasoningDisplay({
	text,
}: { type: "reasoning"; text: string; status?: unknown }) {
	return (
		<CollapsiblePanel
			className="bg-amber-50/50 dark:bg-amber-950/20"
			header={
				<span className="text-amber-600 dark:text-amber-400 text-xs font-medium">
					Thinking
				</span>
			}
		>
			<pre className="max-h-64 overflow-auto text-xs text-muted-foreground whitespace-pre-wrap">
				{text}
			</pre>
		</CollapsiblePanel>
	);
}
