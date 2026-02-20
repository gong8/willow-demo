import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
	type CommitDetail,
	type LinkChangeSummary,
	type NodeChangeSummary,
	fetchCommitDetail,
	restoreToCommit,
} from "../../lib/api.js";

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

export function CommitDetailPanel({
	hash,
}: {
	hash: string;
}) {
	const queryClient = useQueryClient();
	const [confirmRestore, setConfirmRestore] = useState(false);

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
		<div className="flex flex-1 flex-col overflow-y-auto p-6">
			<div className="mb-6">
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
			</div>

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

			<div className="mt-6 border-t border-border pt-4">
				{confirmRestore ? (
					<div className="flex items-center gap-3">
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
					</div>
				) : (
					<button
						type="button"
						onClick={() => setConfirmRestore(true)}
						className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						Restore to this commit
					</button>
				)}
			</div>
		</div>
	);
}
