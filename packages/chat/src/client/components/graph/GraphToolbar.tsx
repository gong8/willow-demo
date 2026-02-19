import { LayoutGrid, Search } from "lucide-react";
import type { GraphStats, LayoutType } from "../../lib/graph-types.js";

const LAYOUTS: { value: LayoutType; label: string }[] = [
	{ value: "forceDirected2d", label: "Force" },
	{ value: "circular2d", label: "Circular" },
	{ value: "radialOut2d", label: "Radial" },
	{ value: "hierarchicalTd", label: "Tree" },
	{ value: "nooverlap", label: "Grid" },
];

export function GraphToolbar({
	searchQuery,
	onSearchChange,
	layout,
	onLayoutChange,
	stats,
}: {
	searchQuery: string;
	onSearchChange: (q: string) => void;
	layout: LayoutType;
	onLayoutChange: (l: LayoutType) => void;
	stats: GraphStats;
}) {
	return (
		<div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-2">
			{/* Search */}
			<div className="relative flex-1 max-w-xs">
				<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<input
					type="text"
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					placeholder="Search nodes..."
					className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
				/>
			</div>

			{/* Layout switcher */}
			<div className="flex items-center gap-1.5">
				<LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
				<select
					value={layout}
					onChange={(e) => onLayoutChange(e.target.value as LayoutType)}
					className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
				>
					{LAYOUTS.map((l) => (
						<option key={l.value} value={l.value}>
							{l.label}
						</option>
					))}
				</select>
			</div>

			{/* Stats */}
			<div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
				<span>{stats.nodeCount} nodes</span>
				<span>{stats.treeEdgeCount} edges</span>
				{stats.linkCount > 0 && <span>{stats.linkCount} links</span>}
			</div>
		</div>
	);
}
