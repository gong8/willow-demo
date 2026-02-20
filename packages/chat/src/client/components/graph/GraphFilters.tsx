import type { NodeType } from "../../lib/graph-types.js";
import { DEFAULT_LINK_COLOR, LINK_COLORS } from "../../lib/graph-transform.js";

const NODE_TYPE_CONFIG: { type: NodeType; label: string; color: string }[] = [
	{ type: "root", label: "Root", color: "#6366f1" },
	{ type: "category", label: "Categories", color: "#8b5cf6" },
	{ type: "collection", label: "Collections", color: "#a78bfa" },
	{ type: "entity", label: "Entities", color: "#f59e0b" },
	{ type: "attribute", label: "Attributes", color: "#06b6d4" },
	{ type: "event", label: "Events", color: "#22c55e" },
	{ type: "detail", label: "Details", color: "#94a3b8" },
];

export function GraphFilters({
	enabledTypes,
	onToggle,
	nodesByType,
	enabledRelations,
	onToggleRelation,
	linksByRelation,
	relationTypes,
}: {
	enabledTypes: Set<NodeType>;
	onToggle: (type: NodeType) => void;
	nodesByType: Record<string, number>;
	enabledRelations: Set<string>;
	onToggleRelation: (relation: string) => void;
	linksByRelation: Record<string, number>;
	relationTypes: string[];
}) {
	return (
		<div className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-muted/20 p-3">
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

			{relationTypes.length > 0 && (
				<>
					<h3 className="mt-3 mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Link Types
					</h3>
					{relationTypes.map((relation) => {
						const count = linksByRelation[relation] ?? 0;
						const enabled = enabledRelations.has(relation);
						const color = LINK_COLORS[relation] ?? DEFAULT_LINK_COLOR;
						return (
							<button
								key={relation}
								type="button"
								onClick={() => onToggleRelation(relation)}
								className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
									enabled
										? "text-foreground"
										: "text-muted-foreground opacity-50"
								} hover:bg-accent/50`}
							>
								<span
									className="inline-block h-2.5 w-2.5 rounded-full"
									style={{ backgroundColor: enabled ? color : "#64748b" }}
								/>
								<span className="flex-1 text-left">{relation}</span>
								<span className="text-xs text-muted-foreground">{count}</span>
							</button>
						);
					})}
				</>
			)}
		</div>
	);
}
