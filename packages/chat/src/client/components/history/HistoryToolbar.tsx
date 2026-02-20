import { GitBranch } from "lucide-react";
import type { BranchInfo } from "../../lib/api.js";

export type SourceFilter = "conversation" | "maintenance" | "manual";

const SOURCE_FILTERS: { value: SourceFilter; label: string; color: string }[] =
	[
		{
			value: "conversation",
			label: "Conversation",
			color: "bg-blue-500/15 text-blue-400 border-blue-500/30",
		},
		{
			value: "maintenance",
			label: "Maintenance",
			color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
		},
		{
			value: "manual",
			label: "Manual",
			color: "bg-green-500/15 text-green-400 border-green-500/30",
		},
	];

export function HistoryToolbar({
	branches,
	commitCount,
	activeFilters,
	onToggleFilter,
}: {
	branches: BranchInfo[];
	commitCount: number;
	activeFilters: Set<SourceFilter>;
	onToggleFilter: (filter: SourceFilter) => void;
}) {
	const currentBranch = branches.find((b) => b.isCurrent)?.name ?? "main";

	return (
		<div className="flex items-center gap-3 px-4 py-2">
			<div className="flex items-center gap-1.5">
				<GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="text-sm text-foreground">{currentBranch}</span>
			</div>

			<div className="flex items-center gap-1">
				{SOURCE_FILTERS.map(({ value, label, color }) => {
					const isActive = activeFilters.has(value);
					return (
						<button
							key={value}
							type="button"
							onClick={() => onToggleFilter(value)}
							className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-opacity ${color} ${
								isActive ? "opacity-100" : "opacity-40"
							}`}
						>
							{label}
						</button>
					);
				})}
			</div>

			<div className="ml-auto text-xs text-muted-foreground">
				{commitCount} commit{commitCount !== 1 ? "s" : ""}
			</div>
		</div>
	);
}
