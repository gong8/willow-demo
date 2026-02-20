import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { GraphCanvas } from "reagraph";
import type { WillowGraph } from "../../lib/graph-types";
import { GraphFilters } from "./GraphFilters";
import { GraphToolbar } from "./GraphToolbar";
import { MaintenanceIndicator } from "./MaintenanceIndicator";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { useGraphFilters } from "./useGraphFilters";

async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}

export function GraphView(_props: { activeConversationId: string | null }) {
	const { data: graph } = useQuery<WillowGraph>({
		queryKey: ["graph"],
		queryFn: fetchGraph,
		refetchInterval: 30_000,
	});

	const filters = useGraphFilters(graph);
	const isEmpty = !graph || Object.keys(graph.nodes).length <= 1;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center border-b border-border bg-muted/30 pr-3">
				<GraphToolbar
					searchQuery={filters.searchQuery}
					onSearchChange={filters.setSearchQuery}
					layout={filters.layout}
					onLayoutChange={filters.setLayout}
					stats={filters.stats}
				/>
				<MaintenanceIndicator />
			</div>

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
						enabledTypes={filters.enabledTypes}
						onToggle={filters.toggleType}
						nodesByType={filters.stats.nodesByType}
						enabledRelations={filters.enabledRelations}
						onToggleRelation={filters.toggleRelation}
						linksByRelation={filters.stats.linksByRelation}
						relationTypes={filters.stats.relationTypes}
					/>

					<div className="relative flex-1">
						{filters.nodes.length > 0 && (
							<GraphCanvas
								nodes={filters.nodes}
								edges={filters.edges}
								layoutType={filters.layout}
								edgeArrowPosition="end"
								labelType="all"
								draggable
								selections={filters.selections}
								onNodeClick={(node) => filters.selectNode(node.id)}
								onCanvasClick={filters.clearSelection}
							/>
						)}
					</div>

					{filters.selectedNode && graph && (
						<NodeDetailPanel
							node={filters.selectedNode}
							graph={graph}
							onClose={filters.clearSelection}
						/>
					)}
				</div>
			)}
		</div>
	);
}
