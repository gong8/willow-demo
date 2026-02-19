import type { NodeType } from "../../lib/graph-types.js";

const NODE_TYPE_CONFIG: { type: NodeType; label: string; color: string }[] = [
	{ type: "root", label: "Root", color: "#6366f1" },
	{ type: "category", label: "Categories", color: "#8b5cf6" },
	{ type: "detail", label: "Details", color: "#06b6d4" },
];

export function GraphFilters({
	enabledTypes,
	onToggle,
	nodesByType,
}: {
	enabledTypes: Set<NodeType>;
	onToggle: (type: NodeType) => void;
	nodesByType: Record<string, number>;
}) {
	return (
		<div className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-muted/20 p-3">
			<h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				Node Types
			</h3>
			{NODE_TYPE_CONFIG.map(({ type, label, color }) => {
				const count = nodesByType[type] ?? 0;
				const enabled = enabledTypes.has(type);
				return (
					<button
						key={type}
						type="button"
						onClick={() => onToggle(type)}
						className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
							enabled ? "text-foreground" : "text-muted-foreground opacity-50"
						} hover:bg-accent/50`}
					>
						<span
							className="inline-block h-2.5 w-2.5 rounded-full"
							style={{ backgroundColor: enabled ? color : "#64748b" }}
						/>
						<span className="flex-1 text-left">{label}</span>
						<span className="text-xs text-muted-foreground">{count}</span>
					</button>
				);
			})}
		</div>
	);
}
