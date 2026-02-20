import type { CrawlerReport, Finding } from "./types.js";

const RESOLVER_SYSTEM_PROMPT = `You are a knowledge graph resolver agent. You have received findings from
automated pre-scans and intelligent crawler agents. Your job is to execute
fixes and improvements using the available tools.

PRIORITIES:
1. Fix critical structural issues first (broken links, orphans)
2. Fix misnamed links (delete old link + add new link with correct relation)
3. Set link confidence and bidirectional flags using update_link
4. Resolve duplicates (keep the more detailed/recent node, delete the other)
5. Apply enhancements (add temporal metadata, create missing links, restructure)

RULES:
- For non-canonical relations: delete the link and recreate with the closest
  canonical relation (related_to, contradicts, caused_by, leads_to, depends_on,
  similar_to, part_of, example_of, derived_from). Use "related_to" if unsure.
- To rename a link: use delete_link to remove the old one, then add_link
  with the corrected relation name.
- To set confidence or bidirectional flag on a link: use update_link with the link ID.
  Confidence levels: "low", "medium", "high". Set bidirectional: true for symmetric relations.
- When merging duplicates, preserve the more detailed content and more
  recent timestamps.
- For missing links, use the relation type suggested by the crawler.
- Be conservative with structural changes (moving nodes). Prefer adding
  links and metadata over restructuring.
- There is no move_node tool. To move a node: create new node under the
  correct parent, recreate any links, then delete the old node.
- Explain each action briefly before executing.

IMPORTANT CONSTRAINTS:
- Only use MCP tools prefixed with mcp__willow__ to manage the knowledge graph.
- Never attempt to use filesystem, code editing, web browsing, or any non-MCP tools.
- When you need to perform multiple knowledge graph operations, make all tool calls in parallel within a single response.`;

function formatFindings(findings: Finding[], header: string): string {
	if (findings.length === 0) return "";
	const items = findings
		.map(
			(f) =>
				`- [${f.id}] ${f.title}\n  ${f.description}${f.suggestedAction ? `\n  Suggested: ${f.suggestedAction}` : ""}${f.nodeIds.length > 0 ? `\n  Nodes: ${f.nodeIds.join(", ")}` : ""}${f.linkIds.length > 0 ? `\n  Links: ${f.linkIds.join(", ")}` : ""}`,
		)
		.join("\n\n");
	return `## ${header}\n\n${items}\n`;
}

export function buildResolverSystemPrompt(): string {
	return RESOLVER_SYSTEM_PROMPT;
}

export function buildResolverUserPrompt(
	preScanFindings: Finding[],
	crawlerReports: CrawlerReport[],
): string {
	const allCrawlerFindings = crawlerReports.flatMap((r) => r.findings);

	// Group findings by action type
	const critical = [
		...preScanFindings.filter((f) => f.severity === "critical"),
		...allCrawlerFindings.filter((f) => f.severity === "critical"),
	];

	const linkFixes = allCrawlerFindings.filter(
		(f) =>
			f.category === "non_canonical_relation" ||
			f.category === "misnamed_link" ||
			f.category === "redundant_link" ||
			f.category === "low_confidence_link" ||
			f.category === "wrong_direction",
	);

	const duplicatesAndContradictions = allCrawlerFindings.filter(
		(f) => f.category === "duplicate_node" || f.category === "contradiction",
	);

	const enhancements = allCrawlerFindings.filter(
		(f) =>
			f.category === "missing_link" ||
			f.category === "missing_temporal" ||
			f.category === "type_mismatch" ||
			f.category === "misplaced_node" ||
			f.category === "restructure" ||
			f.category === "enhancement",
	);

	const cleanup = [
		...preScanFindings.filter(
			(f) => f.severity !== "critical" && f.category === "expired_temporal",
		),
		...allCrawlerFindings.filter(
			(f) =>
				f.category === "vague_content" || f.category === "overcrowded_category",
		),
	];

	// Build the prompt sections — skip empty sections
	const sections = [
		formatFindings(critical, "CRITICAL FIXES (must address)"),
		formatFindings(linkFixes, "LINK FIXES"),
		formatFindings(
			duplicatesAndContradictions,
			"DUPLICATE/CONTRADICTION RESOLUTION",
		),
		formatFindings(enhancements, "ENHANCEMENT OPPORTUNITIES"),
		formatFindings(cleanup, "CLEANUP"),
	].filter(Boolean);

	const totalFindings = preScanFindings.length + allCrawlerFindings.length;

	const summary = [
		`Total findings: ${totalFindings}`,
		`Pre-scan: ${preScanFindings.length}`,
		`Crawler reports: ${crawlerReports.length}`,
		`Crawler findings: ${allCrawlerFindings.length}`,
	].join(" | ");

	return `# Graph Maintenance Findings\n\n${summary}\n\n${sections.join("\n")}\nAddress each finding using the available tools. Work through them in priority order.`;
}

/** Returns true if findings exceed 50, indicating need for split passes. */
export function needsSplitPasses(
	preScanFindings: Finding[],
	crawlerReports: CrawlerReport[],
): boolean {
	const total =
		preScanFindings.length +
		crawlerReports.reduce((sum, r) => sum + r.findings.length, 0);
	return total > 50;
}

function filterFindings(
	preScanFindings: Finding[],
	crawlerReports: CrawlerReport[],
	predicate: (f: Finding) => boolean,
): { preScan: Finding[]; reports: CrawlerReport[] } {
	return {
		preScan: preScanFindings.filter(predicate),
		reports: crawlerReports.map((r) => ({
			...r,
			findings: r.findings.filter(predicate),
		})),
	};
}

export function buildFixPassPrompt(
	preScanFindings: Finding[],
	crawlerReports: CrawlerReport[],
): string {
	const { preScan, reports } = filterFindings(
		preScanFindings,
		crawlerReports,
		(f) => f.severity !== "suggestion",
	);
	return buildResolverUserPrompt(preScan, reports);
}

export function buildEnhancementPassPrompt(
	crawlerReports: CrawlerReport[],
): string {
	const { reports } = filterFindings(
		[],
		crawlerReports,
		(f) => f.severity === "suggestion",
	);
	return buildResolverUserPrompt([], reports);
}
