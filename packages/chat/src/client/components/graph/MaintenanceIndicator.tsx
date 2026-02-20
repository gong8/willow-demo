import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	Loader2,
	Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMaintenanceStatus } from "../../hooks/useMaintenanceStatus";
import type { MaintenanceProgress } from "../../lib/api";

const PHASE_WEIGHTS = {
	"pre-scan": { start: 0, weight: 5 },
	crawling: { start: 5, weight: 55 },
	resolving: { start: 60, weight: 35 },
	committing: { start: 95, weight: 5 },
	done: { start: 100, weight: 0 },
} as const;

function computeOverallPercent(progress: MaintenanceProgress): number {
	const pw = PHASE_WEIGHTS[progress.phase];
	if (progress.phase === "done") return 100;
	if (progress.phase === "crawling" && progress.crawlersTotal > 0) {
		const within = progress.crawlersComplete / progress.crawlersTotal;
		return Math.round(pw.start + pw.weight * within);
	}
	return pw.start;
}

function formatDuration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

const STATUS_ICONS = {
	running: <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />,
	error: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
	complete: <Check className="h-3.5 w-3.5 text-green-600" />,
} as const;

function StatusIcon({ status }: { status: string }) {
	return (
		(STATUS_ICONS[status as keyof typeof STATUS_ICONS] as React.ReactNode) ?? (
			<Wrench className="h-3.5 w-3.5" />
		)
	);
}

function PhaseDetail({
	progress,
	elapsed,
}: { progress: MaintenanceProgress; elapsed: string }) {
	switch (progress.phase) {
		case "pre-scan":
			return <span>Analyzing graph structure...</span>;
		case "crawling":
			if (progress.crawlersTotal === 0) return null;
			return (
				<span>
					{progress.crawlersComplete} of {progress.crawlersTotal} crawlers
					complete
					{progress.totalFindings > 0 && (
						<> &middot; {progress.totalFindings} findings</>
					)}
				</span>
			);
		case "resolving":
			return (
				<span>
					{progress.totalFindings} findings &middot; {progress.resolverActions}{" "}
					actions
				</span>
			);
		case "committing":
			return <span>Saving changes...</span>;
		case "done":
			return (
				<span>
					{progress.totalFindings} findings &middot; {progress.resolverActions}{" "}
					actions &middot; {elapsed}
				</span>
			);
	}
}

function ProgressPanel({
	progress,
	job,
}: {
	progress: MaintenanceProgress;
	job: { status: string; startedAt: string; completedAt?: string };
}) {
	const percent = computeOverallPercent(progress);
	const isDone = progress.phase === "done" || job.status === "complete";
	const elapsed = formatDuration(
		(job.completedAt ? new Date(job.completedAt).getTime() : Date.now()) -
			new Date(job.startedAt).getTime(),
	);

	const eta = useMemo(() => {
		if (
			progress.phase !== "crawling" ||
			progress.crawlersComplete === 0 ||
			progress.crawlersTotal === 0
		)
			return null;
		const rate =
			(Date.now() - progress.phaseStartedAt) / progress.crawlersComplete;
		return `~${formatDuration(rate * (progress.crawlersTotal - progress.crawlersComplete))}`;
	}, [progress]);

	const indeterminate = progress.phase === "resolving";

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between text-sm">
				<div className="flex items-center gap-1.5">
					<StatusIcon status={isDone ? "complete" : "running"} />
					<span className="text-foreground">{progress.phaseLabel}</span>
				</div>
				<span className="text-muted-foreground text-xs tabular-nums">
					{isDone ? elapsed : (eta ?? `${percent}%`)}
				</span>
			</div>
			<div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-500 ease-out ${
						indeterminate
							? "w-full animate-pulse bg-violet-500/60"
							: "bg-violet-500"
					}`}
					style={
						indeterminate
							? undefined
							: { width: `${Math.min(isDone ? 100 : percent, 100)}%` }
					}
				/>
			</div>
			<div className="text-xs text-muted-foreground tabular-nums">
				<PhaseDetail
					progress={isDone ? { ...progress, phase: "done" } : progress}
					elapsed={elapsed}
				/>
			</div>
		</div>
	);
}

export function MaintenanceIndicator() {
	const { status, trigger, invalidateGraph } = useMaintenanceStatus();
	const [expanded, setExpanded] = useState(false);
	const prevStatusRef = useRef<string | null>(null);

	const job = status?.currentJob ?? null;
	const isRunning = job?.status === "running";
	const progress = job?.progress ?? null;

	const percent = useMemo(
		() => (progress ? computeOverallPercent(progress) : 0),
		[progress],
	);

	useEffect(() => {
		if (prevStatusRef.current !== "running" && job?.status === "running") {
			setExpanded(true);
		}
		if (prevStatusRef.current === "running" && job?.status === "complete") {
			invalidateGraph();
			const timer = setTimeout(() => setExpanded(false), 5000);
			return () => clearTimeout(timer);
		}
		prevStatusRef.current = job?.status ?? null;
	}, [job?.status, invalidateGraph]);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => (job ? setExpanded(!expanded) : trigger())}
				className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
				title={
					isRunning
						? "Maintenance running — click to see details"
						: "Run graph maintenance"
				}
			>
				<StatusIcon status={job?.status ?? "idle"} />
				<span>{isRunning && progress ? `${percent}%` : "Maintain"}</span>
				{job &&
					(expanded ? (
						<ChevronDown className="h-3 w-3" />
					) : (
						<ChevronRight className="h-3 w-3" />
					))}
			</button>

			{expanded && job && (
				<div className="absolute right-0 top-full z-10 mt-1 w-80 rounded-lg border border-border bg-background p-3 shadow-lg">
					{progress ? (
						<ProgressPanel progress={progress} job={job} />
					) : (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<StatusIcon status={job.status} />
							<span>
								{job.status === "running"
									? "Starting maintenance..."
									: job.status === "error"
										? "Maintenance failed"
										: "Maintenance complete"}
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
