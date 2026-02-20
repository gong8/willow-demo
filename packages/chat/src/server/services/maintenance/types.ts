export type FindingSeverity = "critical" | "warning" | "suggestion";

export type PreScanCategory =
	| "broken_link"
	| "orphan_node"
	| "broken_parent"
	| "expired_temporal";

export type CrawlerCategory =
	| "non_canonical_relation"
	| "misnamed_link"
	| "missing_link"
	| "redundant_link"
	| "low_confidence_link"
	| "wrong_direction"
	| "duplicate_node"
	| "contradiction"
	| "misplaced_node"
	| "type_mismatch"
	| "vague_content"
	| "missing_temporal"
	| "overcrowded_category"
	| "restructure"
	| "enhancement";

export type FindingCategory = PreScanCategory | CrawlerCategory;

export interface Finding {
	id: string;
	category: FindingCategory;
	severity: FindingSeverity;
	source: string;
	title: string;
	description: string;
	nodeIds: string[];
	linkIds: string[];
	suggestedAction?: string;
}

export interface CrawlerReport {
	subtreeRoot: string;
	subtreeContent: string;
	nodesExplored: number;
	findings: Finding[];
}

export interface GraphStats {
	nodeCount: number;
	linkCount: number;
	categoryCount: number;
}

export interface MaintenanceReport {
	preScanFindings: Finding[];
	crawlerReports: CrawlerReport[];
	resolverActions: number;
	graphStats: GraphStats;
	durationMs: number;
}

export type MaintenancePhase =
	| "pre-scan"
	| "crawling"
	| "resolving"
	| "committing"
	| "done";

export interface MaintenanceProgress {
	phase: MaintenancePhase;
	phaseLabel: string;
	crawlersTotal: number;
	crawlersComplete: number;
	totalFindings: number;
	resolverActions: number;
	phaseStartedAt: number;
}

export type ProgressCallback = (progress: MaintenanceProgress) => void;

export interface RawGraph {
	root_id: string;
	nodes: Record<string, RawNode>;
	links: Record<string, RawLink>;
}

export interface RawNode {
	id: string;
	node_type: string;
	content: string;
	parent_id: string | null;
	children: string[];
	metadata: Record<string, string>;
	temporal: {
		valid_from: string | null;
		valid_until: string | null;
		label: string | null;
	} | null;
	created_at: string;
	updated_at: string;
}

export interface RawLink {
	id: string;
	from_node: string;
	to_node: string;
	relation: string;
	bidirectional: boolean;
	confidence: string | null;
	created_at: string;
}
