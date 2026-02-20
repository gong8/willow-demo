import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
	type BranchInfo,
	type CommitEntry,
	type GraphStatus,
	fetchBranches,
	fetchCommitLog,
	fetchGraphStatus,
} from "../../lib/api.js";
import { CommitDetailPanel } from "./CommitDetailPanel.js";
import { CommitLog } from "./CommitLog.js";
import { CompareView } from "./CompareView.js";
import { HistoryToolbar, type SourceFilter } from "./HistoryToolbar.js";

type ViewMode =
	| { type: "detail"; hash: string }
	| { type: "compare"; fromHash: string; toHash: string }
	| null;

export function HistoryView() {
	const [viewMode, setViewMode] = useState<ViewMode>(null);
	const [activeFilters, setActiveFilters] = useState<Set<SourceFilter>>(
		() => new Set<SourceFilter>(["conversation", "maintenance", "manual"]),
	);
	const [compareSelections, setCompareSelections] = useState<string[]>([]);

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

	const filteredCommits = useMemo(() => {
		if (activeFilters.size === 3) return commits;
		return commits.filter((c) => activeFilters.has(c.source as SourceFilter));
	}, [commits, activeFilters]);

	const handleToggleFilter = useCallback((filter: SourceFilter) => {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(filter)) {
				if (next.size > 1) next.delete(filter);
			} else {
				next.add(filter);
			}
			return next;
		});
	}, []);

	const handleSelect = useCallback((hash: string) => {
		setViewMode({ type: "detail", hash });
		setCompareSelections([]);
	}, []);

	const handleCompareSelect = useCallback((hash: string) => {
		setCompareSelections((prev) => {
			if (prev.includes(hash)) {
				return prev.filter((h) => h !== hash);
			}
			if (prev.length >= 2) {
				return [prev[1], hash];
			}
			return [...prev, hash];
		});
	}, []);

	const handleCompare = useCallback(() => {
		if (compareSelections.length === 2) {
			const indices = compareSelections.map((h) =>
				commits.findIndex((c) => c.hash === h),
			);
			const [fromHash, toHash] =
				indices[0] > indices[1]
					? [compareSelections[0], compareSelections[1]]
					: [compareSelections[1], compareSelections[0]];
			setViewMode({ type: "compare", fromHash, toHash });
		}
	}, [compareSelections, commits]);

	const handleCompareWithCurrent = useCallback(() => {
		if (viewMode?.type === "detail" && commits.length > 0) {
			const currentHead = commits[0].hash;
			if (currentHead !== viewMode.hash) {
				setViewMode({
					type: "compare",
					fromHash: viewMode.hash,
					toHash: currentHead,
				});
				setCompareSelections([]);
			}
		}
	}, [viewMode, commits]);

	const handleExitCompare = useCallback(() => {
		setViewMode(null);
		setCompareSelections([]);
	}, []);

	const selectedHash = viewMode?.type === "detail" ? viewMode.hash : null;
	const isHeadSelected = selectedHash != null && selectedHash === headHash;
	const showActions = !isHeadSelected || hasLocalChanges;

	const isEmpty = commits.length === 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b border-border bg-muted/30">
				<HistoryToolbar
					branches={branches}
					commitCount={filteredCommits.length}
					activeFilters={activeFilters}
					onToggleFilter={handleToggleFilter}
				/>
			</div>

			{isEmpty ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
					<History className="h-12 w-12 opacity-30" />
					<p className="text-sm">No version history yet</p>
				</div>
			) : (
				<div className="flex flex-1 overflow-hidden">
					<CommitLog
						commits={filteredCommits}
						selectedHash={selectedHash}
						headHash={headHash}
						hasLocalChanges={hasLocalChanges}
						onSelect={handleSelect}
						compareSelections={compareSelections}
						onCompareSelect={handleCompareSelect}
						onCompare={
							compareSelections.length === 2 ? handleCompare : undefined
						}
					/>

					{viewMode?.type === "compare" ? (
						<CompareView
							fromHash={viewMode.fromHash}
							toHash={viewMode.toHash}
							onClose={handleExitCompare}
						/>
					) : selectedHash ? (
						<CommitDetailPanel
							hash={selectedHash}
							onCompareWithCurrent={
								showActions ? handleCompareWithCurrent : undefined
							}
							showRestore={showActions}
						/>
					) : (
						<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
							Select a commit to view details
						</div>
					)}
				</div>
			)}
		</div>
	);
}
