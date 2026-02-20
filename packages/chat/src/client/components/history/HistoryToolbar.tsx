import { GitBranch } from "lucide-react";
import type { BranchInfo } from "../../lib/api.js";

export function HistoryToolbar({
	branches,
	commitCount,
}: {
	branches: BranchInfo[];
	commitCount: number;
}) {
	const currentBranch = branches.find((b) => b.isCurrent)?.name ?? "main";

	return (
		<div className="flex items-center gap-3 px-4 py-2">
			<div className="flex items-center gap-1.5">
				<GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="text-sm text-foreground">{currentBranch}</span>
			</div>

			<div className="ml-auto text-xs text-muted-foreground">
				{commitCount} commit{commitCount !== 1 ? "s" : ""}
			</div>
		</div>
	);
}
