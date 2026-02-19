import {
	Check,
	ChevronDown,
	ChevronRight,
	Loader2,
	Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMaintenanceStatus } from "../../hooks/useMaintenanceStatus.js";
import { WillowToolViz } from "../chat/graph-viz/WillowToolViz.js";

export function MaintenanceIndicator() {
	const { status, trigger, invalidateGraph } = useMaintenanceStatus();
	const [expanded, setExpanded] = useState(false);
	const prevStatusRef = useRef<string | null>(null);

	const job = status?.currentJob ?? null;
	const isRunning = job?.status === "running";

	// Invalidate graph cache when job completes
	useEffect(() => {
		if (prevStatusRef.current === "running" && job?.status === "complete") {
			invalidateGraph();
		}
		prevStatusRef.current = job?.status ?? null;
	}, [job?.status, invalidateGraph]);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => {
					if (job) {
						setExpanded(!expanded);
					} else {
						trigger();
					}
				}}
				className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
				title={isRunning ? "Maintenance running — click to see details" : "Run graph maintenance"}
			>
				{isRunning ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
				) : (
					<Wrench className="h-3.5 w-3.5" />
				)}
				<span>Maintain</span>
				{job &&
					(expanded ? (
						<ChevronDown className="h-3 w-3" />
					) : (
						<ChevronRight className="h-3 w-3" />
					))}
			</button>

			{expanded && job && (
				<div className="absolute right-0 top-full z-10 mt-1 w-80 rounded-lg border border-border bg-background shadow-lg">
					<div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
						{job.status === "running" ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
						) : job.status === "complete" ? (
							<Check className="h-3.5 w-3.5 text-green-600" />
						) : (
							<span className="h-3.5 w-3.5 text-red-500">!</span>
						)}
						<span className="text-muted-foreground">
							{job.status === "running"
								? "Maintaining graph..."
								: job.status === "complete"
									? "Maintenance complete"
									: "Maintenance failed"}
						</span>
					</div>
					{job.toolCalls.length > 0 && (
						<div className="max-h-64 overflow-y-auto px-3 py-2 space-y-1">
							{job.toolCalls.map((tc) => (
								<WillowToolViz
									key={tc.toolCallId}
									toolName={tc.toolName}
									args={tc.args}
									result={tc.result}
									isError={tc.isError}
								/>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
