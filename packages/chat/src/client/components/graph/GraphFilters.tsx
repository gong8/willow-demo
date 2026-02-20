import {
	DEFAULT_LINK_COLOR,
	LINK_COLORS,
	NODE_COLORS,
} from "../../lib/graph-transform.js";
import type { NodeType } from "../../lib/graph-types.js";

const NODE_TYPE_LABELS: Record<NodeType, string> = {
	root: "Root",
	category: "Categories",
	collection: "Collections",
	entity: "Entities",
	attribute: "Attributes",
	event: "Events",
	detail: "Details",
};

const NODE_TYPES: NodeType[] = [
	"root",
	"category",
	"collection",
	"entity",
	"attribute",
	"event",
	"detail",
];

function FilterButton({
	label,
	color,
	count,
	enabled,
	onClick,
}: {
	label: string;
	color: string;
	count: number;
	enabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
				enabled ? "text-foreground" : "text-muted-foreground opacity-50"
			} hover:bg-accent/50`}
		>
			<span
				className="inline-block h-2.5 w-2.5 rounded-full"
				style={{ backgroundColor: enabled ? color : "#64748b" }}
			/>
			<span className="flex-1 truncate text-left">{label}</span>
			<span className="text-xs text-muted-foreground">{count}</span>
		</button>
	);
}

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
		<div className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-muted/20 p-3">
			<h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				Node Types
			</h3>
			{NODE_TYPES.map((type) => (
				<FilterButton
					key={type}
					label={NODE_TYPE_LABELS[type]}
					color={NODE_COLORS[type]}
					count={nodesByType[type] ?? 0}
					enabled={enabledTypes.has(type)}
					onClick={() => onToggle(type)}
				/>
			))}

			{relationTypes.length > 0 && (
				<>
					<h3 className="mt-3 mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Link Types
					</h3>
					{relationTypes.map((relation) => (
						<FilterButton
							key={relation}
							label={relation}
							color={LINK_COLORS[relation] ?? DEFAULT_LINK_COLOR}
							count={linksByRelation[relation] ?? 0}
							enabled={enabledRelations.has(relation)}
							onClick={() => onToggleRelation(relation)}
						/>
					))}
				</>
			)}
		</div>
	);
}
