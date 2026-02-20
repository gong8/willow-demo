import { ArrowRight } from "lucide-react";
import type { LinkChangeSummary, NodeChangeSummary } from "../../lib/api.js";

export function ChangeSection({
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

export function LinkSection({
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

export function DiffSectionList({ diff }: { diff: ChangeSummaryLike }) {
	const hasChanges =
		diff.nodesCreated.length > 0 ||
		diff.nodesUpdated.length > 0 ||
		diff.nodesDeleted.length > 0 ||
		diff.linksCreated.length > 0 ||
		diff.linksRemoved.length > 0;

	if (!hasChanges) return null;

	return (
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
	);
}

interface ChangeSummaryLike {
	nodesCreated: NodeChangeSummary[];
	nodesUpdated: NodeChangeSummary[];
	nodesDeleted: NodeChangeSummary[];
	linksCreated: LinkChangeSummary[];
	linksRemoved: LinkChangeSummary[];
}
