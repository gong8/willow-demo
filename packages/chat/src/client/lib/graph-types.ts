// Willow knowledge graph JSON structure (as stored in graph.json)

export interface WillowNodeMeta {
	source?: string;
	confidence?: string;
	valid_from?: string;
	valid_until?: string;
	[key: string]: unknown;
}

export interface WillowNodeHistory {
	content: string;
	timestamp: string;
	reason?: string;
}

export interface WillowNode {
	id: string;
	node_type:
		| "root"
		| "category"
		| "collection"
		| "entity"
		| "attribute"
		| "event"
		| "detail";
	content: string;
	parent_id: string | null;
	children: string[];
	created_at: string;
	updated_at: string;
	metadata: WillowNodeMeta;
	history: WillowNodeHistory[];
}

export interface WillowLink {
	id: string;
	from_node: string;
	to_node: string;
	relation: string;
	bidirectional: boolean;
	confidence: string | null;
	created_at: string;
}

export interface WillowGraph {
	root_id: string;
	nodes: Record<string, WillowNode>;
	links: Record<string, WillowLink>;
}

// reagraph-compatible types (no custom `data` — look up WillowNode separately)

export interface GraphNode {
	id: string;
	label: string;
	fill: string;
	size: number;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	label?: string;
	size: number;
	fill: string;
}

export interface GraphStats {
	nodeCount: number;
	linkCount: number;
	treeEdgeCount: number;
	nodesByType: Record<string, number>;
	relationTypes: string[];
	linksByRelation: Record<string, number>;
}

export type NodeType =
	| "root"
	| "category"
	| "collection"
	| "entity"
	| "attribute"
	| "event"
	| "detail";
export type LayoutType =
	| "forceDirected2d"
	| "circular2d"
	| "radialOut2d"
	| "hierarchicalTd"
	| "nooverlap";
