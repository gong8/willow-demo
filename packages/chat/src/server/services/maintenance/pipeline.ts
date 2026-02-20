import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createLogger } from "../../logger";
import type { CrawlerSubtree } from "./crawler";
import { spawnCrawlers } from "./crawler";
import { runPreScan } from "./pre-scan";
import { spawnResolver } from "./resolver";
import type {
	GraphStats,
	MaintenanceProgress,
	MaintenanceReport,
	ProgressCallback,
	RawGraph,
} from "./types";

const log = createLogger("maintenance:pipeline");

function loadGraph(): RawGraph {
	const graphPath =
		process.env.WILLOW_GRAPH_PATH ??
		resolve(homedir(), ".willow", "graph.json");
	return JSON.parse(readFileSync(graphPath, "utf-8")) as RawGraph;
}

function getGraphStats(graph: RawGraph): GraphStats {
	return {
		nodeCount: Object.keys(graph.nodes).length,
		linkCount: Object.keys(graph.links).length,
		categoryCount: graph.nodes[graph.root_id]?.children.length ?? 0,
	};
}

function getTopLevelSubtrees(graph: RawGraph): CrawlerSubtree[] {
	const root = graph.nodes[graph.root_id];
	if (!root) return [];
	return root.children.flatMap((childId) => {
		const node = graph.nodes[childId];
		return node ? [{ id: childId, content: node.content }] : [];
	});
}

function buildGraphSummary(
	graph: RawGraph,
	subtrees: CrawlerSubtree[],
): string {
	const lines = subtrees.map((s) => {
		const childCount = graph.nodes[s.id]?.children.length ?? 0;
		return `- ${s.content} (${childCount} children)`;
	});
	return `Top-level categories:\n${lines.join("\n")}`;
}

function emptyReport(graphStats: GraphStats, start: number): MaintenanceReport {
	return {
		preScanFindings: [],
		crawlerReports: [],
		resolverActions: 0,
		graphStats,
		durationMs: Date.now() - start,
	};
}

export async function runMaintenancePipeline(options: {
	mcpServerPath: string;
	trigger: "manual" | "auto";
	onProgress?: ProgressCallback;
}): Promise<MaintenanceReport> {
	const start = Date.now();
	log.info("Pipeline started", { trigger: options.trigger });

	const progress: MaintenanceProgress = {
		phase: "pre-scan",
		phaseLabel: "Scanning graph...",
		crawlersTotal: 0,
		crawlersComplete: 0,
		totalFindings: 0,
		resolverActions: 0,
		phaseStartedAt: Date.now(),
	};

	const emitProgress = (updates: Partial<MaintenanceProgress>) => {
		Object.assign(progress, updates);
		options.onProgress?.({ ...progress });
	};

	// Load graph
	let graph: RawGraph;
	try {
		graph = loadGraph();
	} catch (e) {
		log.error("Failed to load graph", { error: (e as Error).message });
		return emptyReport({ nodeCount: 0, linkCount: 0, categoryCount: 0 }, start);
	}

	const graphStats = getGraphStats(graph);
	log.info("Graph loaded", { ...graphStats });

	// Pre-scan (fast, no Claude)
	const preScanFindings = runPreScan(graph);
	log.info("Pre-scan complete", { findings: preScanFindings.length });

	// Crawl subtrees
	const subtrees = getTopLevelSubtrees(graph);
	let crawlerReports: Awaited<ReturnType<typeof spawnCrawlers>> = [];

	if (subtrees.length > 0) {
		const graphSummary = buildGraphSummary(graph, subtrees);
		emitProgress({
			phase: "crawling",
			phaseLabel: `Crawling ${subtrees.length} categories...`,
			crawlersTotal: subtrees.length,
			crawlersComplete: 0,
			phaseStartedAt: Date.now(),
		});

		log.info("Spawning crawlers", { count: subtrees.length });
		crawlerReports = await spawnCrawlers({
			subtrees,
			mcpServerPath: options.mcpServerPath,
			graphSummary,
			preScanFindings,
			onCrawlerComplete: () => {
				progress.crawlersComplete++;
				emitProgress({ crawlersComplete: progress.crawlersComplete });
			},
		});

		log.info("All crawlers complete", {
			reports: crawlerReports.length,
			totalFindings: crawlerReports.reduce(
				(sum, r) => sum + r.findings.length,
				0,
			),
		});
	} else {
		log.info("No subtrees to crawl, skipping crawler phase");
	}

	// Resolve findings
	const totalCrawlerFindings = crawlerReports.reduce(
		(sum, r) => sum + r.findings.length,
		0,
	);
	const totalFindings = preScanFindings.length + totalCrawlerFindings;
	let resolverActions = 0;

	if (totalFindings > 0) {
		emitProgress({
			phase: "resolving",
			phaseLabel: `Resolving ${totalFindings} findings...`,
			totalFindings,
			resolverActions: 0,
			phaseStartedAt: Date.now(),
		});

		const result = await spawnResolver({
			preScanFindings,
			crawlerReports,
			mcpServerPath: options.mcpServerPath,
			onAction: () => {
				progress.resolverActions++;
				emitProgress({ resolverActions: progress.resolverActions });
			},
		});
		resolverActions = result.actionsExecuted;
	} else {
		log.info("No findings — skipping resolver");
	}

	// Commit
	emitProgress({
		phase: "committing",
		phaseLabel: "Committing changes...",
		totalFindings,
		phaseStartedAt: Date.now(),
	});

	const report: MaintenanceReport = {
		preScanFindings,
		crawlerReports,
		resolverActions,
		graphStats,
		durationMs: Date.now() - start,
	};

	log.info("Pipeline complete", {
		preScan: preScanFindings.length,
		crawlerFindings: totalCrawlerFindings,
		resolverActions,
		durationMs: report.durationMs,
	});

	emitProgress({
		phase: "done",
		phaseLabel: "Maintenance complete",
		phaseStartedAt: Date.now(),
	});

	return report;
}
