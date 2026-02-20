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

const LINK_FIX_CATEGORIES: Set<string> = new Set([
	"non_canonical_relation",
	"misnamed_link",
	"redundant_link",
	"low_confidence_link",
	"wrong_direction",
]);

const DUPLICATE_CATEGORIES: Set<string> = new Set([
	"duplicate_node",
	"contradiction",
]);

const ENHANCEMENT_CATEGORIES: Set<string> = new Set([
	"missing_link",
	"missing_temporal",
	"type_mismatch",
	"misplaced_node",
	"restructure",
	"enhancement",
]);

const CLEANUP_CATEGORIES: Set<string> = new Set([
	"expired_temporal",
	"vague_content",
	"overcrowded_category",
]);

function classifyFinding(f: Finding): string {
	if (f.severity === "critical") return "critical";
	if (LINK_FIX_CATEGORIES.has(f.category)) return "link";
	if (DUPLICATE_CATEGORIES.has(f.category)) return "duplicate";
	if (ENHANCEMENT_CATEGORIES.has(f.category)) return "enhancement";
	if (CLEANUP_CATEGORIES.has(f.category)) return "cleanup";
	return "cleanup";
}

const SECTION_HEADERS: Record<string, string> = {
	critical: "CRITICAL FIXES (must address)",
	link: "LINK FIXES",
	duplicate: "DUPLICATE/CONTRADICTION RESOLUTION",
	enhancement: "ENHANCEMENT OPPORTUNITIES",
	cleanup: "CLEANUP",
};

export function buildResolverUserPrompt(
	preScanFindings: Finding[],
	crawlerReports: CrawlerReport[],
): string {
	const allFindings = [
		...preScanFindings,
		...crawlerReports.flatMap((r) => r.findings),
	];

	const groups: Record<string, Finding[]> = {};
	for (const f of allFindings) {
		const key = classifyFinding(f);
		(groups[key] ??= []).push(f);
	}

	const sections = Object.entries(SECTION_HEADERS)
		.map(([key, header]) => formatFindings(groups[key] ?? [], header))
		.filter(Boolean);

	const summary = [
		`Total findings: ${allFindings.length}`,
		`Pre-scan: ${preScanFindings.length}`,
		`Crawler reports: ${crawlerReports.length}`,
		`Crawler findings: ${allFindings.length - preScanFindings.length}`,
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
