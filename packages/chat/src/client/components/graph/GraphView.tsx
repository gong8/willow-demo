import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { GraphCanvas } from "reagraph";
import { transformGraphData } from "../../lib/graph-transform.js";
import type {
	LayoutType,
	NodeType,
	WillowGraph,
} from "../../lib/graph-types.js";
import { GraphFilters } from "./GraphFilters.js";
import { GraphToolbar } from "./GraphToolbar.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";

async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}

export function GraphView() {
	const { data: graph } = useQuery<WillowGraph>({
		queryKey: ["graph"],
		queryFn: fetchGraph,
		refetchInterval: 30_000,
	});

	const [searchQuery, setSearchQuery] = useState("");
	const [layout, setLayout] = useState<LayoutType>("forceDirected2d");
	const [enabledTypes, setEnabledTypes] = useState<Set<NodeType>>(
		() => new Set(["root", "category", "detail"]),
	);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selections, setSelections] = useState<string[]>([]);

	const handleToggleType = (type: NodeType) => {
		setEnabledTypes((prev) => {
			const next = new Set(prev);
			if (next.has(type)) {
				next.delete(type);
			} else {
				next.add(type);
			}
			return next;
		});
	};

	const handleNodeClick = useCallback((node: { id: string }) => {
		setSelectedNodeId(node.id);
		setSelections([node.id]);
	}, []);

	const handleCanvasClick = useCallback(() => {
		setSelectedNodeId(null);
		setSelections([]);
	}, []);

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
		return transformGraphData(graph, { enabledTypes, searchQuery });
	}, [graph, enabledTypes, searchQuery]);

	const selectedNode =
		selectedNodeId && graph ? graph.nodes[selectedNodeId] : null;

	// Empty state: no graph data or only root node
	const isEmpty = !graph || Object.keys(graph.nodes).length <= 1;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<GraphToolbar
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
				layout={layout}
				onLayoutChange={setLayout}
				stats={stats}
			/>

			{isEmpty ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
					<Network className="h-12 w-12 opacity-30" />
					<p className="text-sm">
						Start a conversation to build your knowledge graph
					</p>
				</div>
			) : (
				<div className="flex flex-1 overflow-hidden">
					<GraphFilters
						enabledTypes={enabledTypes}
						onToggle={handleToggleType}
						nodesByType={stats.nodesByType}
					/>

					<div className="relative flex-1">
						{nodes.length > 0 && (
							<GraphCanvas
								nodes={nodes}
								edges={edges}
								layoutType={layout}
								edgeArrowPosition="end"
								labelType="all"
								draggable
								selections={selections}
								onNodeClick={handleNodeClick}
								onCanvasClick={handleCanvasClick}
							/>
						)}
					</div>

					{selectedNode && graph && (
						<NodeDetailPanel
							node={selectedNode}
							graph={graph}
							onClose={handleCanvasClick}
						/>
					)}
				</div>
			)}
		</div>
	);
}
