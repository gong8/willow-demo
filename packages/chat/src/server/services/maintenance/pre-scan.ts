import type { Finding, RawGraph } from "./types";

let nextId = 1;

function finding(fields: Omit<Finding, "id" | "source">): Finding {
	return {
		id: `PRE-${String(nextId++).padStart(3, "0")}`,
		source: "pre-scan",
		...fields,
	};
}

function snippet(content: string): string {
	return content.slice(0, 50);
}

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

function checkOrphansAndParents(graph: RawGraph): Finding[] {
	const findings: Finding[] = [];

	// BFS from root to find reachable nodes
	const visited = new Set<string>();
	const queue = [graph.root_id];
	for (let nodeId = queue.shift(); nodeId; nodeId = queue.shift()) {
		if (visited.has(nodeId)) continue;
		visited.add(nodeId);
		const node = graph.nodes[nodeId];
		if (node) queue.push(...node.children.filter((c) => !visited.has(c)));
	}

	for (const [nodeId, node] of Object.entries(graph.nodes)) {
		if (!visited.has(nodeId)) {
			findings.push(
				finding({
					category: "orphan_node",
					severity: "critical",
					title: `Orphan node: "${snippet(node.content)}"`,
					description: `Node "${nodeId}" is not reachable from root via children arrays.`,
					nodeIds: [nodeId],
					linkIds: [],
					suggestedAction: `Delete orphan node ${nodeId} or re-parent it`,
				}),
			);
		}

		if (!node.parent_id) continue;
		const parent = graph.nodes[node.parent_id];
		if (!parent) {
			findings.push(
				finding({
					category: "broken_parent",
					severity: "critical",
					title: `Parent node missing for "${snippet(node.content)}"`,
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
					title: `Parent-child mismatch for "${snippet(node.content)}"`,
					description: `Node "${nodeId}" claims parent "${node.parent_id}" but parent's children array does not include it.`,
					nodeIds: [nodeId, node.parent_id],
					linkIds: [],
					suggestedAction: `Add ${nodeId} to parent's children array or update parent_id`,
				}),
			);
		}
	}

	return findings;
}

function checkExpiredTemporal(graph: RawGraph): Finding[] {
	const now = new Date();
	const findings: Finding[] = [];

	for (const [nodeId, node] of Object.entries(graph.nodes)) {
		const validUntil = node.temporal?.valid_until;
		if (validUntil && new Date(validUntil) < now) {
			findings.push(
				finding({
					category: "expired_temporal",
					severity: "warning",
					title: `Expired fact: "${snippet(node.content)}"`,
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
