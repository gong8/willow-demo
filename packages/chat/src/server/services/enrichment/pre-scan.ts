import type { Finding, RawGraph } from "./types.js";

let nextId = 1;
function preScanId(): string {
	return `PRE-${String(nextId++).padStart(3, "0")}`;
}

/** Check that both endpoints of every link exist and are not self-links. */
function checkLinkIntegrity(graph: RawGraph): Finding[] {
	const findings: Finding[] = [];
	for (const [linkId, link] of Object.entries(graph.links)) {
		if (!graph.nodes[link.from_node]) {
			findings.push({
				id: preScanId(),
				category: "broken_link",
				severity: "critical",
				source: "pre-scan",
				title: `Link source node missing: ${link.from_node}`,
				description: `Link "${linkId}" (${link.relation}) references non-existent source node "${link.from_node}".`,
				nodeIds: [link.from_node, link.to_node],
				linkIds: [linkId],
				suggestedAction: `Delete link ${linkId}`,
			});
		}
		if (!graph.nodes[link.to_node]) {
			findings.push({
				id: preScanId(),
				category: "broken_link",
				severity: "critical",
				source: "pre-scan",
				title: `Link target node missing: ${link.to_node}`,
				description: `Link "${linkId}" (${link.relation}) references non-existent target node "${link.to_node}".`,
				nodeIds: [link.from_node, link.to_node],
				linkIds: [linkId],
				suggestedAction: `Delete link ${linkId}`,
			});
		}
		if (link.from_node === link.to_node) {
			findings.push({
				id: preScanId(),
				category: "broken_link",
				severity: "warning",
				source: "pre-scan",
				title: `Self-link on node ${link.from_node}`,
				description: `Link "${linkId}" is a self-link (${link.relation}) on node "${link.from_node}".`,
				nodeIds: [link.from_node],
				linkIds: [linkId],
				suggestedAction: `Delete self-link ${linkId}`,
			});
		}
	}
	return findings;
}

/** BFS from root to find orphan nodes and broken parent references. */
function checkOrphansAndParents(graph: RawGraph): Finding[] {
	const findings: Finding[] = [];
	const visited = new Set<string>();
	const queue = [graph.root_id];

	// BFS from root via children arrays
	for (
		let nodeId = queue.shift();
		nodeId !== undefined;
		nodeId = queue.shift()
	) {
		if (visited.has(nodeId)) continue;
		visited.add(nodeId);

		const node = graph.nodes[nodeId];
		if (!node) continue;

		for (const childId of node.children) {
			if (!visited.has(childId)) {
				queue.push(childId);
			}
		}
	}

	// Any node not visited is an orphan
	for (const [nodeId, node] of Object.entries(graph.nodes)) {
		if (!visited.has(nodeId)) {
			findings.push({
				id: preScanId(),
				category: "orphan_node",
				severity: "critical",
				source: "pre-scan",
				title: `Orphan node: "${node.content.slice(0, 50)}"`,
				description: `Node "${nodeId}" is not reachable from root via children arrays.`,
				nodeIds: [nodeId],
				linkIds: [],
				suggestedAction: `Delete orphan node ${nodeId} or re-parent it`,
			});
		}

		// Check parent consistency
		if (node.parent_id) {
			const parent = graph.nodes[node.parent_id];
			if (!parent) {
				findings.push({
					id: preScanId(),
					category: "broken_parent",
					severity: "critical",
					source: "pre-scan",
					title: `Parent node missing for "${node.content.slice(0, 50)}"`,
					description: `Node "${nodeId}" references non-existent parent "${node.parent_id}".`,
					nodeIds: [nodeId],
					linkIds: [],
					suggestedAction: `Re-parent node ${nodeId} under root or delete it`,
				});
			} else if (!parent.children.includes(nodeId)) {
				findings.push({
					id: preScanId(),
					category: "broken_parent",
					severity: "warning",
					source: "pre-scan",
					title: `Parent-child mismatch for "${node.content.slice(0, 50)}"`,
					description: `Node "${nodeId}" claims parent "${node.parent_id}" but parent's children array does not include it.`,
					nodeIds: [nodeId, node.parent_id],
					linkIds: [],
					suggestedAction: `Add ${nodeId} to parent's children array or update parent_id`,
				});
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
		if (node.temporal?.valid_until) {
			const expiry = new Date(node.temporal.valid_until);
			if (expiry < now) {
				findings.push({
					id: preScanId(),
					category: "expired_temporal",
					severity: "warning",
					source: "pre-scan",
					title: `Expired fact: "${node.content.slice(0, 50)}"`,
					description: `Node "${nodeId}" has valid_until "${node.temporal.valid_until}" which is in the past.`,
					nodeIds: [nodeId],
					linkIds: [],
					suggestedAction: `Review and update or delete expired node ${nodeId}`,
				});
			}
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
