import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { createLogger } from "../../logger.js";
import type { CrawlerSubtree } from "./crawler.js";
import { spawnCrawlers } from "./crawler.js";
import { runPreScan } from "./pre-scan.js";
import { spawnResolver } from "./resolver.js";
import type { EnrichmentReport, RawGraph } from "./types.js";

const log = createLogger("enricher");

function loadGraph(): RawGraph {
	const graphPath =
		process.env.WILLOW_GRAPH_PATH ??
		resolve(homedir(), ".willow", "graph.json");
	const raw = readFileSync(graphPath, "utf-8");
	return JSON.parse(raw) as RawGraph;
}

function getGraphStats(graph: RawGraph): {
	nodeCount: number;
	linkCount: number;
	categoryCount: number;
} {
	const nodeCount = Object.keys(graph.nodes).length;
	const linkCount = Object.keys(graph.links).length;
	const rootNode = graph.nodes[graph.root_id];
	const categoryCount = rootNode ? rootNode.children.length : 0;
	return { nodeCount, linkCount, categoryCount };
}

function getTopLevelSubtrees(graph: RawGraph): CrawlerSubtree[] {
	const rootNode = graph.nodes[graph.root_id];
	if (!rootNode) return [];

	return rootNode.children
		.map((childId) => {
			const node = graph.nodes[childId];
			if (!node) return null;
			return { id: childId, content: node.content };
		})
		.filter((s): s is CrawlerSubtree => s !== null);
}

function buildGraphSummary(
	graph: RawGraph,
	subtrees: CrawlerSubtree[],
): string {
	const lines = subtrees.map((s) => {
		const node = graph.nodes[s.id];
		const childCount = node ? node.children.length : 0;
		return `- ${s.content} (${childCount} children)`;
	});
	return `Top-level categories:\n${lines.join("\n")}`;
}

export async function runEnrichment(options: {
	mcpServerPath: string;
	trigger: "manual" | "auto";
}): Promise<EnrichmentReport> {
	const start = Date.now();
	log.info("Enrichment started", { trigger: options.trigger });

	// Step 1: Load graph
	let graph: RawGraph;
	try {
		graph = loadGraph();
	} catch (e) {
		log.error("Failed to load graph", { error: (e as Error).message });
		return {
			preScanFindings: [],
			crawlerReports: [],
			resolverActions: 0,
			graphStats: { nodeCount: 0, linkCount: 0, categoryCount: 0 },
			durationMs: Date.now() - start,
		};
	}

	const graphStats = getGraphStats(graph);
	log.info("Graph loaded", graphStats);

	// Step 2: Pre-scan (fast, no Claude)
	const preScanFindings = runPreScan(graph);
	log.info("Pre-scan complete", { findings: preScanFindings.length });

	// Step 3: Identify subtrees for crawlers
	const subtrees = getTopLevelSubtrees(graph);
	if (subtrees.length === 0) {
		log.info("No subtrees to crawl, skipping crawler phase");
		// Still run resolver for pre-scan findings if any
		const resolverResult =
			preScanFindings.length > 0
				? await spawnResolver({
						preScanFindings,
						crawlerReports: [],
						mcpServerPath: options.mcpServerPath,
					})
				: { actionsExecuted: 0 };

		return {
			preScanFindings,
			crawlerReports: [],
			resolverActions: resolverResult.actionsExecuted,
			graphStats,
			durationMs: Date.now() - start,
		};
	}

	const graphSummary = buildGraphSummary(graph, subtrees);

	// Step 4: Spawn crawlers in parallel
	log.info("Spawning crawlers", { count: subtrees.length });
	const crawlerReports = await spawnCrawlers({
		subtrees,
		mcpServerPath: options.mcpServerPath,
		graphSummary,
		preScanFindings,
	});

	const totalCrawlerFindings = crawlerReports.reduce(
		(sum, r) => sum + r.findings.length,
		0,
	);
	log.info("All crawlers complete", {
		reports: crawlerReports.length,
		totalFindings: totalCrawlerFindings,
	});

	// Step 5: Spawn resolver if there are any findings
	const totalFindings = preScanFindings.length + totalCrawlerFindings;
	let resolverActions = 0;

	if (totalFindings > 0) {
		const resolverResult = await spawnResolver({
			preScanFindings,
			crawlerReports,
			mcpServerPath: options.mcpServerPath,
		});
		resolverActions = resolverResult.actionsExecuted;
	} else {
		log.info("No findings — skipping resolver");
	}

	const report: EnrichmentReport = {
		preScanFindings,
		crawlerReports,
		resolverActions,
		graphStats,
		durationMs: Date.now() - start,
	};

	log.info("Enrichment complete", {
		preScan: preScanFindings.length,
		crawlerFindings: totalCrawlerFindings,
		resolverActions,
		durationMs: report.durationMs,
	});

	return report;
}
