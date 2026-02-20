import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import {
	type BranchInfo,
	type CommitEntry,
	fetchBranches,
	fetchCommitLog,
} from "../../lib/api.js";
import { CommitDetailPanel } from "./CommitDetailPanel.js";
import { CommitLog } from "./CommitLog.js";
import { HistoryToolbar } from "./HistoryToolbar.js";

export function HistoryView() {
	const [selectedHash, setSelectedHash] = useState<string | null>(null);

	const { data: commits = [] } = useQuery<CommitEntry[]>({
		queryKey: ["commit-log"],
		queryFn: () => fetchCommitLog(50),
	});

	const { data: branches = [] } = useQuery<BranchInfo[]>({
		queryKey: ["branches"],
		queryFn: fetchBranches,
	});

	const isEmpty = commits.length === 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b border-border bg-muted/30">
				<HistoryToolbar branches={branches} commitCount={commits.length} />
			</div>

			{isEmpty ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
					<History className="h-12 w-12 opacity-30" />
					<p className="text-sm">No version history yet</p>
				</div>
			) : (
				<div className="flex flex-1 overflow-hidden">
					<CommitLog
						commits={commits}
						selectedHash={selectedHash}
						onSelect={setSelectedHash}
					/>

					{selectedHash ? (
						<CommitDetailPanel hash={selectedHash} />
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
