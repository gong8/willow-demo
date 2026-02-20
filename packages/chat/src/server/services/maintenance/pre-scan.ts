import type { Finding, RawGraph } from "./types.js";

let nextId = 1;

function finding(fields: Omit<Finding, "id" | "source">): Finding {
	return {
		id: `PRE-${String(nextId++).padStart(3, "0")}`,
		source: "pre-scan",
		...fields,
	};
}

/** Check that both endpoints of every link exist and are not self-links. */
function checkLinkIntegrity(graph: RawGraph): Finding[] {
	const findings: Finding[] = [];
	for (const [linkId, link] of Object.entries(graph.links)) {
		for (const [endpoint, label] of [
			[link.from_node, "source"],
			[link.to_node, "target"],
		] as const) {
			if (!graph.nodes[endpoint]) {
				findings.push(
					finding({
						category: "broken_link",
						severity: "critical",
						title: `Link ${label} node missing: ${endpoint}`,
						description: `Link "${linkId}" (${link.relation}) references non-existent ${label} node "${endpoint}".`,
						nodeIds: [link.from_node, link.to_node],
						linkIds: [linkId],
						suggestedAction: `Delete link ${linkId}`,
					}),
				);
			}
		}
		if (link.from_node === link.to_node) {
			findings.push(
				finding({
					category: "broken_link",
					severity: "warning",
					title: `Self-link on node ${link.from_node}`,
					description: `Link "${linkId}" is a self-link (${link.relation}) on node "${link.from_node}".`,
					nodeIds: [link.from_node],
					linkIds: [linkId],
					suggestedAction: `Delete self-link ${linkId}`,
				}),
			);
		}
	}
	return findings;
}

/** BFS from root to find orphan nodes and broken parent references. */
function checkOrphansAndParents(graph: RawGraph): Finding[] {
	const findings: Finding[] = [];
	const visited = new Set<string>();
	const queue = [graph.root_id];

	while (queue.length > 0) {
		const nodeId = queue.shift()!;
		if (visited.has(nodeId)) continue;
		visited.add(nodeId);

		const node = graph.nodes[nodeId];
		if (!node) continue;

		for (const childId of node.children) {
			if (!visited.has(childId)) queue.push(childId);
		}
	}

	for (const [nodeId, node] of Object.entries(graph.nodes)) {
		if (!visited.has(nodeId)) {
			findings.push(
				finding({
					category: "orphan_node",
					severity: "critical",
					title: `Orphan node: "${node.content.slice(0, 50)}"`,
					description: `Node "${nodeId}" is not reachable from root via children arrays.`,
					nodeIds: [nodeId],
					linkIds: [],
					suggestedAction: `Delete orphan node ${nodeId} or re-parent it`,
				}),
			);
		}

		if (node.parent_id) {
			const parent = graph.nodes[node.parent_id];
			if (!parent) {
				findings.push(
					finding({
						category: "broken_parent",
						severity: "critical",
						title: `Parent node missing for "${node.content.slice(0, 50)}"`,
						description: `Node "${nodeId}" references non-existent parent "${node.parent_id}".`,
						nodeIds: [nodeId],
						linkIds: [],
						suggestedAction: `Re-parent node ${nodeId} under root or delete it`,
					}),
				);
			} else if (!parent.children.includes(nodeId)) {
				findings.push(
					finding({
						category: "broken_parent",
						severity: "warning",
						title: `Parent-child mismatch for "${node.content.slice(0, 50)}"`,
						description: `Node "${nodeId}" claims parent "${node.parent_id}" but parent's children array does not include it.`,
						nodeIds: [nodeId, node.parent_id],
						linkIds: [],
						suggestedAction: `Add ${nodeId} to parent's children array or update parent_id`,
					}),
				);
			}
		}
	}

	return findings;
}

/** Find nodes with temporal.valid_until in the past. */
function checkExpiredTemporal(graph: RawGraph): Finding[] {
	const findings: Finding[] = [];
	const now = new Date();

	for (const [nodeId, node] of Object.entries(graph.nodes)) {
		const validUntil = node.temporal?.valid_until;
		if (validUntil && new Date(validUntil) < now) {
			findings.push(
				finding({
					category: "expired_temporal",
					severity: "warning",
					title: `Expired fact: "${node.content.slice(0, 50)}"`,
					description: `Node "${nodeId}" has valid_until "${validUntil}" which is in the past.`,
					nodeIds: [nodeId],
					linkIds: [],
					suggestedAction: `Review and update or delete expired node ${nodeId}`,
				}),
			);
		}
	}

	return findings;
}

/** Run all pre-scan checks on a raw graph. Pure, fast, no Claude. */
export function runPreScan(graph: RawGraph): Finding[] {
	nextId = 1;
	return [
		...checkLinkIntegrity(graph),
		...checkOrphansAndParents(graph),
		...checkExpiredTemporal(graph),
	];
}
