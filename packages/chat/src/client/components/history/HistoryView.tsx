import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import {
	type BranchInfo,
	type CommitEntry,
	type GraphStatus,
	fetchBranches,
	fetchCommitLog,
	fetchGraphStatus,
} from "../../lib/api";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { CommitLog } from "./CommitLog";
import { CompareView } from "./CompareView";
import { HistoryToolbar } from "./HistoryToolbar";
import { LocalChangesPanel } from "./LocalChangesPanel";
import { useCommitSelection } from "./useCommitSelection";
import { useSourceFilters } from "./useSourceFilters";

export function HistoryView() {
	const { data: commits = [] } = useQuery<CommitEntry[]>({
		queryKey: ["commit-log"],
		queryFn: () => fetchCommitLog(50),
	});

	const { data: branches = [] } = useQuery<BranchInfo[]>({
		queryKey: ["branches"],
		queryFn: fetchBranches,
	});

	const { data: status } = useQuery<GraphStatus>({
		queryKey: ["graph-status"],
		queryFn: fetchGraphStatus,
		refetchInterval: 10_000,
	});

	const headHash = status?.headHash ?? null;
	const hasLocalChanges = status?.hasLocalChanges ?? false;

	const { activeFilters, toggleFilter, filtered } = useSourceFilters(commits);

	const {
		viewMode,
		compareSelections,
		selectCommit,
		selectLocalChanges,
		toggleCompareSelection,
		confirmCompare,
		compareWithCurrent,
		exitCompare,
	} = useCommitSelection(commits);

	const selectedHash = viewMode?.type === "detail" ? viewMode.hash : null;
	const showActions = selectedHash !== headHash || hasLocalChanges;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b border-border bg-muted/30">
				<HistoryToolbar
					branches={branches}
					commitCount={filtered.length}
					activeFilters={activeFilters}
					onToggleFilter={toggleFilter}
				/>
			</div>

			{commits.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
					<History className="h-12 w-12 opacity-30" />
					<p className="text-sm">No version history yet</p>
				</div>
			) : (
				<div className="flex flex-1 overflow-hidden">
					<CommitLog
						commits={filtered}
						selectedHash={selectedHash}
						headHash={headHash}
						hasLocalChanges={hasLocalChanges}
						showLocalSelected={viewMode?.type === "local-changes"}
						onSelect={selectCommit}
						onSelectLocalChanges={selectLocalChanges}
						compareSelections={compareSelections}
						onCompareSelect={toggleCompareSelection}
						onCompare={
							compareSelections.length === 2 ? confirmCompare : undefined
						}
					/>

					<DetailPanel
						viewMode={viewMode}
						selectedHash={selectedHash}
						showActions={showActions}
						compareWithCurrent={compareWithCurrent}
						exitCompare={exitCompare}
					/>
				</div>
			)}
		</div>
	);
}

function DetailPanel({
	viewMode,
	selectedHash,
	showActions,
	compareWithCurrent,
	exitCompare,
}: {
	viewMode: ReturnType<typeof useCommitSelection>["viewMode"];
	selectedHash: string | null;
	showActions: boolean;
	compareWithCurrent: () => void;
	exitCompare: () => void;
}) {
	if (viewMode?.type === "compare") {
		return (
			<CompareView
				fromHash={viewMode.fromHash}
				toHash={viewMode.toHash}
				onClose={exitCompare}
			/>
		);
	}
	if (viewMode?.type === "local-changes") {
		return <LocalChangesPanel />;
	}
	if (selectedHash) {
		return (
			<CommitDetailPanel
				hash={selectedHash}
				onCompareWithCurrent={showActions ? compareWithCurrent : undefined}
				showRestore={showActions}
			/>
		);
	}
	return (
		<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			Select a commit to view details
		</div>
	);
}
