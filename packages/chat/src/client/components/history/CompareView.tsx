import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useMemo } from "react";
import { GraphCanvas } from "reagraph";
import {
	type ChangeSummary,
	diffCommits,
	fetchGraphAtCommit,
} from "../../lib/api.js";
import {
	NODE_COLORS,
	NODE_SIZES,
	TREE_EDGE_COLOR,
} from "../../lib/graph-transform.js";
import type {
	GraphEdge,
	GraphNode,
	NodeType,
	WillowGraph,
} from "../../lib/graph-types.js";
import { NodeDetailPanel } from "../graph/NodeDetailPanel.js";
import { useGraphSelection } from "./useGraphSelection.js";

const DIFF_COLORS = {
	added: "#22c55e",
	deleted: "#ef4444",
	modified: "#f59e0b",
	unchanged: "#64748b",
} as const;

function buildDiffGraph(
	graph: WillowGraph,
	diff: ChangeSummary,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const createdIds = new Set(diff.nodesCreated.map((n) => n.nodeId));
	const updatedIds = new Set(diff.nodesUpdated.map((n) => n.nodeId));

	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];

	for (const [id, node] of Object.entries(graph.nodes)) {
		let fill: string;
		if (createdIds.has(id)) {
			fill = DIFF_COLORS.added;
		} else if (updatedIds.has(id)) {
			fill = DIFF_COLORS.modified;
		} else {
			fill = DIFF_COLORS.unchanged;
		}

		nodes.push({
			id,
			label:
				node.content.length > 40
					? `${node.content.slice(0, 40)}...`
					: node.content,
			fill,
			size: NODE_SIZES[node.node_type as NodeType] ?? NODE_SIZES.detail,
		});
	}

	for (const deleted of diff.nodesDeleted) {
		if (!graph.nodes[deleted.nodeId]) {
			nodes.push({
				id: deleted.nodeId,
				label:
					deleted.content.length > 40
						? `${deleted.content.slice(0, 40)}...`
						: deleted.content,
				fill: DIFF_COLORS.deleted,
				size: NODE_SIZES[deleted.nodeType as NodeType] ?? NODE_SIZES.detail,
			});
		}
	}

	const nodeIdSet = new Set(nodes.map((n) => n.id));

	for (const [id, node] of Object.entries(graph.nodes)) {
		if (node.parent_id && nodeIdSet.has(node.parent_id)) {
			edges.push({
				id: `tree__${node.parent_id}__${id}`,
				source: node.parent_id,
				target: id,
				size: 1,
				fill: TREE_EDGE_COLOR,
			});
		}
	}

	for (const link of Object.values(graph.links)) {
		if (nodeIdSet.has(link.from_node) && nodeIdSet.has(link.to_node)) {
			edges.push({
				id: `link__${link.id}`,
				source: link.from_node,
				target: link.to_node,
				label: link.relation,
				size: 2,
				fill: NODE_COLORS.attribute,
			});
		}
	}

	return { nodes, edges };
}

export function CompareView({
	fromHash,
	toHash,
	onClose,
}: {
	fromHash: string;
	toHash: string;
	onClose: () => void;
}) {
	const { data: toGraph } = useQuery<WillowGraph>({
		queryKey: ["graph-at-commit", toHash],
		queryFn: () => fetchGraphAtCommit(toHash),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const { data: diff, isLoading } = useQuery<ChangeSummary>({
		queryKey: ["diff", fromHash, toHash],
		queryFn: () => diffCommits(fromHash, toHash),
	});

	const { selectedNodeId, selections, handleNodeClick, handleCanvasClick } =
		useGraphSelection();

	const { nodes, edges } = useMemo(() => {
		if (!toGraph || !diff) return { nodes: [], edges: [] };
		return buildDiffGraph(toGraph, diff);
	}, [toGraph, diff]);

	const totalChanges = diff
		? diff.nodesCreated.length +
			diff.nodesUpdated.length +
			diff.nodesDeleted.length +
			diff.linksCreated.length +
			diff.linksRemoved.length +
			(diff.linksUpdated?.length ?? 0)
		: 0;

	if (isLoading || !diff || !toGraph) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				Loading comparison...
			</div>
		);
	}

	const selectedNode =
		selectedNodeId && toGraph ? toGraph.nodes[selectedNodeId] : null;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-3 border-b border-border px-4 py-2">
				<span className="text-sm font-medium text-foreground">
					Comparing{" "}
					<span className="font-mono text-xs">{fromHash.slice(0, 7)}</span>
					{" → "}
					<span className="font-mono text-xs">{toHash.slice(0, 7)}</span>
				</span>

				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						<span
							className="inline-block h-2 w-2 rounded-full"
							style={{ backgroundColor: DIFF_COLORS.added }}
						/>
						{diff.nodesCreated.length} added
					</span>
					<span className="flex items-center gap-1">
						<span
							className="inline-block h-2 w-2 rounded-full"
							style={{ backgroundColor: DIFF_COLORS.modified }}
						/>
						{diff.nodesUpdated.length} modified
					</span>
					<span className="flex items-center gap-1">
						<span
							className="inline-block h-2 w-2 rounded-full"
							style={{ backgroundColor: DIFF_COLORS.deleted }}
						/>
						{diff.nodesDeleted.length} deleted
					</span>
					<span className="flex items-center gap-1">
						<span
							className="inline-block h-2 w-2 rounded-full"
							style={{ backgroundColor: DIFF_COLORS.unchanged }}
						/>
						unchanged
					</span>
				</div>

				<button
					type="button"
					onClick={onClose}
					className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{/* Graph */}
			{totalChanges === 0 ? (
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					No differences between these commits.
				</div>
			) : (
				<div className="flex flex-1 overflow-hidden">
					<div className="relative flex-1">
						{nodes.length > 0 && (
							<GraphCanvas
								nodes={nodes}
								edges={edges}
								layoutType="forceDirected2d"
								edgeArrowPosition="end"
								labelType="all"
								draggable
								selections={selections}
								onNodeClick={handleNodeClick}
								onCanvasClick={handleCanvasClick}
							/>
						)}
					</div>
					{selectedNode && (
						<NodeDetailPanel
							node={selectedNode}
							graph={toGraph}
							onClose={handleCanvasClick}
						/>
					)}
				</div>
			)}
		</div>
	);
}
