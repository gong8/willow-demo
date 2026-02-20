import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchGraphAtCommit } from "../../lib/api";
import { transformGraphData } from "../../lib/graph-transform";
import type { NodeType, WillowGraph } from "../../lib/graph-types";
import { GraphPreviewShell } from "./GraphPreviewShell";

const ALL_TYPES = new Set<NodeType>([
	"root",
	"category",
	"collection",
	"entity",
	"attribute",
	"event",
	"detail",
]);

export function SnapshotGraphPreview({ hash }: { hash: string }) {
	const { data: graph, isLoading } = useQuery<WillowGraph>({
		queryKey: ["graph-at-commit", hash],
		queryFn: () => fetchGraphAtCommit(hash),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const { nodes, edges, stats } = useMemo(() => {
		if (!graph) {
			return {
				nodes: [],
				edges: [],
				stats: {
					nodeCount: 0,
					linkCount: 0,
					treeEdgeCount: 0,
					nodesByType: {},
					relationTypes: [],
				},
			};
		}
		return transformGraphData(graph, {
			enabledTypes: ALL_TYPES,
			searchQuery: "",
		});
	}, [graph]);

	if (isLoading || !graph) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				Loading graph snapshot...
			</div>
		);
	}

	return (
		<GraphPreviewShell
			nodes={nodes}
			edges={edges}
			graph={graph}
			emptyMessage="No graph data at this commit."
			header={
				<div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
					<span>{stats.nodeCount} nodes</span>
					<span>{stats.treeEdgeCount} edges</span>
					{stats.linkCount > 0 && <span>{stats.linkCount} links</span>}
				</div>
			}
		/>
	);
}
