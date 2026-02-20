export type FindingSeverity = "critical" | "warning" | "suggestion";

export type FindingCategory =
	// pre-scan
	| "broken_link"
	| "orphan_node"
	| "broken_parent"
	| "expired_temporal"
	// crawler
	| "misnamed_link"
	| "missing_link"
	| "redundant_link"
	| "duplicate_node"
	| "contradiction"
	| "misplaced_node"
	| "type_mismatch"
	| "vague_content"
	| "missing_temporal"
	| "overcrowded_category"
	| "restructure"
	| "enrichment";

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

export interface EnrichmentReport {
	preScanFindings: Finding[];
	crawlerReports: CrawlerReport[];
	resolverActions: number;
	graphStats: { nodeCount: number; linkCount: number; categoryCount: number };
	durationMs: number;
}

export interface EnrichmentProgress {
	phase: "pre-scan" | "crawling" | "resolving" | "committing" | "done";
	phaseLabel: string;
	crawlersTotal: number;
	crawlersComplete: number;
	totalFindings: number;
	resolverActions: number;
	phaseStartedAt: number;
}

export type ProgressCallback = (progress: EnrichmentProgress) => void;

// Raw graph JSON types (matching graph.json structure)
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
	created_at: string;
}
