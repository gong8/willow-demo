import { GitBranch } from "lucide-react";
import type { BranchInfo } from "../../lib/api";
import { SOURCE_COLORS } from "./sourceColors";

export type SourceFilter = "conversation" | "maintenance" | "manual";

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
	{ value: "conversation", label: "Conversation" },
	{ value: "maintenance", label: "Maintenance" },
	{ value: "manual", label: "Manual" },
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
				{SOURCE_FILTERS.map(({ value, label }) => {
					const isActive = activeFilters.has(value);
					const color = SOURCE_COLORS[value]?.badge ?? "";
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
