import { X } from "lucide-react";
import type { WillowGraph, WillowNode } from "../../lib/graph-types.js";

export function NodeDetailPanel({
	node,
	graph,
	onClose,
}: {
	node: WillowNode;
	graph: WillowGraph;
	onClose: () => void;
}) {
	// Find parent
	const parent = node.parent_id ? graph.nodes[node.parent_id] : null;

	// Find children
	const children = (node.children ?? []).map((id) => graph.nodes[id]).filter(Boolean);

	// Find links involving this node
	const links = Object.values(graph.links).filter(
		(l) => l.source_id === node.id || l.target_id === node.id,
	);

	return (
		<div className="flex w-72 shrink-0 flex-col border-l border-border bg-muted/20">
			{/* Header */}
			<div className="flex items-start justify-between border-b border-border p-3">
				<div className="min-w-0 flex-1">
					<span className="inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
						{node.node_type}
					</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-3">
				{/* Content */}
				<section className="mb-4">
					<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Content
					</h4>
					<p className="text-sm text-foreground">{node.content}</p>
				</section>

				{/* Parent */}
				{parent && (
					<section className="mb-4">
						<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Parent
						</h4>
						<p className="text-sm text-muted-foreground">{parent.content}</p>
					</section>
				)}

				{/* Children */}
				{children.length > 0 && (
					<section className="mb-4">
						<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Children ({children.length})
						</h4>
						<ul className="space-y-1">
							{children.map((child) => (
								<li key={child.id} className="text-sm text-muted-foreground">
									{child.content}
								</li>
							))}
						</ul>
					</section>
				)}

				{/* Cross-links */}
				{links.length > 0 && (
					<section className="mb-4">
						<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Links ({links.length})
						</h4>
						<ul className="space-y-1">
							{links.map((link) => {
								const otherId =
									link.source_id === node.id ? link.target_id : link.source_id;
								const otherNode = graph.nodes[otherId];
								return (
									<li key={link.id} className="text-sm text-muted-foreground">
										<span className="font-medium text-foreground">
											{link.relation}
										</span>{" "}
										→ {otherNode?.content ?? otherId}
									</li>
								);
							})}
						</ul>
					</section>
				)}

				{/* Metadata */}
				{node.metadata && Object.keys(node.metadata).length > 0 && (
					<section className="mb-4">
						<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Metadata
						</h4>
						<dl className="space-y-0.5 text-sm">
							{Object.entries(node.metadata).map(([key, value]) => (
								<div key={key} className="flex gap-2">
									<dt className="text-muted-foreground">{key}:</dt>
									<dd className="text-foreground">{String(value)}</dd>
								</div>
							))}
						</dl>
					</section>
				)}

				{/* History */}
				{node.history?.length > 0 && (
					<section className="mb-4">
						<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							History ({node.history.length})
						</h4>
						<ul className="space-y-2">
							{node.history.map((entry, i) => (
								<li key={i} className="text-sm">
									<p className="text-muted-foreground">{entry.content}</p>
									<p className="text-[11px] text-muted-foreground/70">
										{new Date(entry.timestamp).toLocaleDateString()}
										{entry.reason && ` — ${entry.reason}`}
									</p>
								</li>
							))}
						</ul>
					</section>
				)}

				{/* Timestamps */}
				<section>
					<h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Dates
					</h4>
					<p className="text-xs text-muted-foreground">
						Created: {new Date(node.created_at).toLocaleDateString()}
					</p>
					<p className="text-xs text-muted-foreground">
						Updated: {new Date(node.updated_at).toLocaleDateString()}
					</p>
				</section>
			</div>
		</div>
	);
}
