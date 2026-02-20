import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
	type ChangeSummary,
	type LinkChangeSummary,
	type NodeChangeSummary,
	fetchLocalDiff,
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

export function LocalChangesPanel() {
	const { data, isLoading } = useQuery<ChangeSummary>({
		queryKey: ["local-diff"],
		queryFn: fetchLocalDiff,
		refetchInterval: 10_000,
	});

	if (isLoading || !data) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				Loading...
			</div>
		);
	}

	const hasChanges =
		data.nodesCreated.length > 0 ||
		data.nodesUpdated.length > 0 ||
		data.nodesDeleted.length > 0 ||
		data.linksCreated.length > 0 ||
		data.linksRemoved.length > 0;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="shrink-0 border-b border-border p-6">
				<h3 className="text-lg font-semibold text-foreground">
					Uncommitted Changes
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					Diff between the current on-disk graph and the last commit
				</p>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				{hasChanges ? (
					<div>
						<ChangeSection
							title="Created"
							items={data.nodesCreated}
							variant="created"
						/>
						<ChangeSection
							title="Updated"
							items={data.nodesUpdated}
							variant="updated"
						/>
						<ChangeSection
							title="Deleted"
							items={data.nodesDeleted}
							variant="deleted"
						/>
						<LinkSection
							title="Created"
							items={data.linksCreated}
							variant="created"
						/>
						<LinkSection
							title="Removed"
							items={data.linksRemoved}
							variant="removed"
						/>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No uncommitted changes detected.
					</p>
				)}
			</div>
		</div>
	);
}
