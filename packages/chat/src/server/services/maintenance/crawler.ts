import { createLogger } from "../../logger.js";
import { getDisallowedTools } from "../agent-tools.js";
import {
	LLM_MODEL,
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	getCliModel,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "../cli-chat.js";
import type { CrawlerReport, Finding } from "./types.js";

const log = createLogger("crawler");

const MAX_CRAWLERS = 8;

function buildCrawlerSystemPrompt(
	subtreeRootId: string,
	subtreeContent: string,
	crawlerIndex: number,
	graphSummary: string,
	preScanFindings: Finding[],
): string {
	const preScanSection =
		preScanFindings.length > 0
			? preScanFindings
					.map((f) => `- [${f.id}] ${f.category}: ${f.title}`)
					.join("\n")
			: "None";

	return `You are a knowledge graph crawler agent. Your job is to EXHAUSTIVELY explore
your assigned subtree and report every issue and improvement opportunity you find.

YOUR SUBTREE: Node "${subtreeContent}" (ID: ${subtreeRootId})

GRAPH OVERVIEW (for cross-reference context):
${graphSummary}

PRE-SCAN FINDINGS IN YOUR SUBTREE:
${preScanSection}

EXPLORATION STRATEGY:
1. Start with get_context(nodeId: "${subtreeRootId}", depth: 3) to see your subtree.
2. For each child, go deeper with get_context(childId, depth: 3).
3. Continue until you've seen every node in your subtree.
4. Use search_nodes to check if any of your nodes duplicate or relate to
   nodes in OTHER subtrees.

FOR EACH NODE, EVALUATE:
- Content quality: Is it clear, specific, non-redundant?
- Node type: Is "detail" actually an "entity"? Is "attribute" actually an "event"?
- Non-canonical relations: Does any link use a relation NOT in the canonical set?
  Canonical relations: related_to, contradicts, caused_by, leads_to, depends_on, similar_to, part_of, example_of, derived_from.
  Report as "non_canonical_relation" if a link uses anything else.
- Links: Do any links touching this node have misleading relation names?
  (e.g., "related_to" when "caused_by" or "part_of" is more accurate)
- Link confidence: Should a link have a confidence level? (low/medium/high)
  Report as "low_confidence_link" if a link seems uncertain.
- Link directionality: Is a directed link that should be bidirectional, or vice versa?
  Report as "wrong_direction" if the bidirectional flag seems incorrect.
- Missing links: Should this node be linked to something else in the graph?
- Temporal: Does the content imply time ("currently", "since 2024") but lack
  temporal metadata?
- Contradictions: Does this conflict with anything else you've seen?
- Structure: Is this node in the right category? Should it be elsewhere?

After exploring, output your complete findings:
<crawler_report>
{
  "subtreeRoot": "${subtreeRootId}",
  "subtreeContent": "${subtreeContent}",
  "nodesExplored": <number>,
  "findings": [
    {
      "id": "C${crawlerIndex}-001",
      "category": "misnamed_link",
      "severity": "warning",
      "title": "Link relation should be 'caused_by' not 'related_to'",
      "description": "The link from 'Stress' to 'Insomnia' uses 'related_to' but the content suggests a causal relationship.",
      "nodeIds": ["node1", "node2"],
      "linkIds": ["link1"],
      "suggestedAction": "Delete link and recreate with relation 'caused_by'"
    }
  ]
}
</crawler_report>

RULES:
- Be thorough — check EVERY node, don't skip any.
- Be specific — include exact node IDs and link IDs in findings.
- Be opinionated — if something could be better, report it.
- Don't make changes — you are read-only. Just report findings.
- Valid categories: non_canonical_relation, misnamed_link, missing_link, redundant_link, low_confidence_link, wrong_direction, duplicate_node, contradiction, misplaced_node, type_mismatch, vague_content, missing_temporal, overcrowded_category, restructure, enhancement
- Valid severities: critical, warning, suggestion`;
}

function parseCrawlerReport(
	textOutput: string,
	subtreeRootId: string,
	subtreeContent: string,
): CrawlerReport {
	const match = textOutput.match(
		/<crawler_report>([\s\S]*?)<\/crawler_report>/,
	);
	if (!match) {
		log.warn("No <crawler_report> found in crawler output", {
			subtreeRootId,
		});
		return {
			subtreeRoot: subtreeRootId,
			subtreeContent,
			nodesExplored: 0,
			findings: [],
		};
	}

	try {
		const parsed = JSON.parse(match[1].trim());
		return {
			subtreeRoot: parsed.subtreeRoot ?? subtreeRootId,
			subtreeContent: parsed.subtreeContent ?? subtreeContent,
			nodesExplored: parsed.nodesExplored ?? 0,
			findings: Array.isArray(parsed.findings)
				? parsed.findings.map(
						(f: Record<string, unknown>) =>
							({
								id: f.id ?? "C?-???",
								category: f.category ?? "enhancement",
								severity: f.severity ?? "suggestion",
								source: `crawler:${subtreeRootId}`,
								title: f.title ?? "",
								description: f.description ?? "",
								nodeIds: Array.isArray(f.nodeIds) ? f.nodeIds : [],
								linkIds: Array.isArray(f.linkIds) ? f.linkIds : [],
								suggestedAction: f.suggestedAction,
							}) as Finding,
					)
				: [],
		};
	} catch (e) {
		log.warn("Failed to parse crawler report JSON", {
			subtreeRootId,
			error: (e as Error).message,
		});
		return {
			subtreeRoot: subtreeRootId,
			subtreeContent,
			nodesExplored: 0,
			findings: [],
		};
	}
}

export interface SpawnCrawlerOptions {
	subtreeRootId: string;
	subtreeContent: string;
	crawlerIndex: number;
	mcpServerPath: string;
	graphSummary: string;
	preScanFindings: Finding[];
}

export function spawnCrawler(
	options: SpawnCrawlerOptions,
	onComplete?: () => void,
): Promise<CrawlerReport> {
	return new Promise((resolve) => {
		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, options.mcpServerPath);
		const systemPromptPath = writeSystemPrompt(
			invocationDir,
			buildCrawlerSystemPrompt(
				options.subtreeRootId,
				options.subtreeContent,
				options.crawlerIndex,
				options.graphSummary,
				options.preScanFindings,
			),
		);

		const prompt = `Explore the subtree rooted at "${options.subtreeContent}" (ID: ${options.subtreeRootId}) and report all findings.`;

		const args = [
			"--print",
			"--output-format",
			"stream-json",
			"--verbose",
			"--include-partial-messages",
			"--model",
			getCliModel(LLM_MODEL),
			"--dangerously-skip-permissions",
			"--mcp-config",
			mcpConfigPath,
			"--strict-mcp-config",
			"--disallowedTools",
			...getDisallowedTools("crawler"),
			"--append-system-prompt-file",
			systemPromptPath,
			"--setting-sources",
			"",
			"--no-session-persistence",
			"--max-turns",
			"10",
			prompt,
		];

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args, invocationDir);
		} catch {
			log.error("Crawler spawn failed", {
				subtreeRootId: options.subtreeRootId,
			});
			cleanupDir(invocationDir);
			resolve({
				subtreeRoot: options.subtreeRootId,
				subtreeContent: options.subtreeContent,
				nodesExplored: 0,
				findings: [],
			});
			return;
		}

		let textOutput = "";

		// Silent emitter — we only care about text output for report parsing
		const emitter = (event: string, data: string) => {
			if (event === "content") {
				try {
					const parsed = JSON.parse(data);
					if (parsed.content) textOutput += parsed.content;
				} catch {
					/* ignore */
				}
			}
		};

		const parser = createStreamParser(emitter);
		proc.stdin?.end();
		pipeStdout(proc, parser);

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString().trim();
			if (text) log.debug("crawler stderr", { text: text.slice(0, 500) });
		});

		const finish = () => {
			cleanupDir(invocationDir);
			const report = parseCrawlerReport(
				textOutput,
				options.subtreeRootId,
				options.subtreeContent,
			);
			log.info("Crawler complete", {
				subtreeRootId: options.subtreeRootId,
				findings: report.findings.length,
				nodesExplored: report.nodesExplored,
			});
			onComplete?.();
			resolve(report);
		};

		proc.on("close", finish);
		proc.on("error", finish);
	});
}

export interface CrawlerSubtree {
	id: string;
	content: string;
}

/**
 * Spawn crawlers for all subtrees in parallel, capping at MAX_CRAWLERS.
 * If there are more subtrees than MAX_CRAWLERS, the smallest ones are combined.
 */
export async function spawnCrawlers(options: {
	subtrees: CrawlerSubtree[];
	mcpServerPath: string;
	graphSummary: string;
	preScanFindings: Finding[];
	onCrawlerComplete?: () => void;
}): Promise<CrawlerReport[]> {
	let subtrees = options.subtrees;

	// If too many subtrees, combine the smallest into one crawler
	if (subtrees.length > MAX_CRAWLERS) {
		log.info("Combining small subtrees", {
			total: subtrees.length,
			max: MAX_CRAWLERS,
		});
		// Keep the first (MAX_CRAWLERS - 1) as-is, combine the rest
		const keep = subtrees.slice(0, MAX_CRAWLERS - 1);
		const combined = subtrees.slice(MAX_CRAWLERS - 1);
		// Use the first combined subtree as the "root" for the combined crawler
		// The crawler will still explore all of them via search
		keep.push({
			id: combined[0].id,
			content: combined.map((s) => s.content).join(", "),
		});
		subtrees = keep;
	}

	// Partition pre-scan findings by subtree
	const findingsForSubtree = (subtreeId: string): Finding[] =>
		options.preScanFindings.filter((f) => f.nodeIds.includes(subtreeId));

	const promises = subtrees.map((subtree, index) =>
		spawnCrawler(
			{
				subtreeRootId: subtree.id,
				subtreeContent: subtree.content,
				crawlerIndex: index + 1,
				mcpServerPath: options.mcpServerPath,
				graphSummary: options.graphSummary,
				preScanFindings: findingsForSubtree(subtree.id),
			},
			options.onCrawlerComplete,
		),
	);

	return Promise.all(promises);
}
