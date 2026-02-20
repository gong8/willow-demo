import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, GitCompare, Network, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
	type CommitDetail,
	type LinkChangeSummary,
	type NodeChangeSummary,
	fetchCommitDetail,
	restoreToCommit,
} from "../../lib/api.js";
import { SnapshotGraphPreview } from "./SnapshotGraphPreview.js";

type TabId = "changes" | "preview";

function ChangeSection({
	title,
	items,
	variant,
}: {
	title: string;
	items: NodeChangeSummary[];
	variant: "created" | "updated" | "deleted";
}) {
	if (items.length === 0) return null;

	const colors = {
		created: "text-green-400",
		updated: "text-amber-400",
		deleted: "text-red-400",
	};

	return (
		<div className="mb-4">
			<h4
				className={`mb-2 text-xs font-medium uppercase tracking-wide ${colors[variant]}`}
			>
				Nodes {title} ({items.length})
			</h4>
			<div className="space-y-1.5">
				{items.map((node) => (
					<div
						key={node.nodeId}
						className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
					>
						<div className="flex items-start gap-2">
							<span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
								{node.nodeType}
							</span>
							<span className="text-foreground">{node.content}</span>
						</div>
						{node.oldContent && (
							<div className="mt-1 flex items-center gap-1.5 pl-0.5 text-xs text-muted-foreground">
								<span className="line-through">{node.oldContent}</span>
								<ArrowRight className="h-3 w-3 shrink-0" />
								<span className="text-foreground">{node.content}</span>
							</div>
						)}
						{node.path.length > 0 && (
							<p className="mt-1 text-xs text-muted-foreground">
								{node.path.join(" > ")}
							</p>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function LinkSection({
	title,
	items,
	variant,
}: {
	title: string;
	items: LinkChangeSummary[];
	variant: "created" | "removed";
}) {
	if (items.length === 0) return null;

	const color = variant === "created" ? "text-green-400" : "text-red-400";

	return (
		<div className="mb-4">
			<h4
				className={`mb-2 text-xs font-medium uppercase tracking-wide ${color}`}
			>
				Links {title} ({items.length})
			</h4>
			<div className="space-y-1.5">
				{items.map((link) => (
					<div
						key={link.linkId}
						className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
					>
						<span className="font-mono text-xs text-muted-foreground">
							{link.fromNode.slice(0, 8)}
						</span>
						<span className="mx-2 text-muted-foreground">
							—{link.relation}→
						</span>
						<span className="font-mono text-xs text-muted-foreground">
							{link.toNode.slice(0, 8)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

const TABS: { id: TabId; label: string; icon: typeof GitCompare }[] = [
	{ id: "changes", label: "Changes", icon: GitCompare },
	{ id: "preview", label: "Graph Preview", icon: Network },
];

export function CommitDetailPanel({
	hash,
	onCompareWithCurrent,
	showRestore = true,
}: {
	hash: string;
	onCompareWithCurrent?: () => void;
	showRestore?: boolean;
}) {
	const queryClient = useQueryClient();
	const [confirmRestore, setConfirmRestore] = useState(false);
	const [activeTab, setActiveTab] = useState<TabId>("changes");

	const { data, isLoading } = useQuery<CommitDetail>({
		queryKey: ["commit-detail", hash],
		queryFn: () => fetchCommitDetail(hash),
	});

	const restoreMutation = useMutation({
		mutationFn: () => restoreToCommit(hash),
		onSuccess: () => {
			setConfirmRestore(false);
			queryClient.invalidateQueries({ queryKey: ["commit-log"] });
			queryClient.invalidateQueries({ queryKey: ["branches"] });
			queryClient.invalidateQueries({ queryKey: ["graph"] });
			queryClient.invalidateQueries({ queryKey: ["graph-status"] });
		},
	});

	if (isLoading || !data) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				Loading...
			</div>
		);
	}

	const { commit, diff } = data;
	const hasChanges =
		diff.nodesCreated.length > 0 ||
		diff.nodesUpdated.length > 0 ||
		diff.nodesDeleted.length > 0 ||
		diff.linksCreated.length > 0 ||
		diff.linksRemoved.length > 0;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Header */}
			<div className="shrink-0 border-b border-border p-6 pb-0">
				<h3 className="text-lg font-semibold text-foreground">
					{commit.message}
				</h3>
				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span className="font-mono">{commit.hash.slice(0, 10)}</span>
					<span>{new Date(commit.timestamp).toLocaleString()}</span>
					<span className="rounded bg-muted px-1.5 py-0.5">
						{commit.source}
					</span>
					{commit.parents.length > 0 && (
						<span>
							parents: {commit.parents.map((p) => p.slice(0, 7)).join(", ")}
						</span>
					)}
				</div>

				{/* Tab bar */}
				<div className="mt-4 flex gap-1">
					{TABS.map((tab) => {
						const Icon = tab.icon;
						const isActive = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className={`flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition-colors ${
									isActive
										? "border-border bg-background text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								<Icon className="h-3.5 w-3.5" />
								{tab.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Tab content */}
			{activeTab === "changes" ? (
				<div className="flex-1 overflow-y-auto p-6">
					{hasChanges ? (
						<div>
							<ChangeSection
								title="Created"
								items={diff.nodesCreated}
								variant="created"
							/>
							<ChangeSection
								title="Updated"
								items={diff.nodesUpdated}
								variant="updated"
							/>
							<ChangeSection
								title="Deleted"
								items={diff.nodesDeleted}
								variant="deleted"
							/>
							<LinkSection
								title="Created"
								items={diff.linksCreated}
								variant="created"
							/>
							<LinkSection
								title="Removed"
								items={diff.linksRemoved}
								variant="removed"
							/>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No changes in this commit.
						</p>
					)}
				</div>
			) : (
				<SnapshotGraphPreview hash={hash} />
			)}

			{/* Footer with restore + compare (hidden when viewing current commit with no local changes) */}
			{(showRestore || onCompareWithCurrent) && (
				<div className="shrink-0 border-t border-border p-4">
					<div className="flex items-center gap-3">
						{confirmRestore ? (
							<>
								<span className="text-sm text-muted-foreground">
									Restore graph to this commit?
								</span>
								<button
									type="button"
									onClick={() => restoreMutation.mutate()}
									disabled={restoreMutation.isPending}
									className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
								>
									{restoreMutation.isPending ? "Restoring..." : "Confirm"}
								</button>
								<button
									type="button"
									onClick={() => setConfirmRestore(false)}
									className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
								>
									Cancel
								</button>
							</>
						) : (
							<>
								{showRestore && (
									<button
										type="button"
										onClick={() => setConfirmRestore(true)}
										className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									>
										<RotateCcw className="h-3.5 w-3.5" />
										Restore to this commit
									</button>
								)}
								{onCompareWithCurrent && (
									<button
										type="button"
										onClick={onCompareWithCurrent}
										className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									>
										<GitCompare className="h-3.5 w-3.5" />
										Compare with current
									</button>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
