import {
	DEFAULT_LINK_COLOR,
	LINK_COLORS,
	NODE_COLORS,
	NODE_SIZES,
	TREE_EDGE_COLOR,
} from "../../../lib/graph-transform.js";
import type {
	GraphEdge,
	GraphNode,
	NodeType,
	WillowGraph,
	WillowNode,
} from "../../../lib/graph-types.js";
import type { AnimationPhase, SubgraphData } from "./types.js";

const MAX_NODES = 30;

// ---------- Helpers ----------

export function buildGraphNode(node: WillowNode): GraphNode {
	return {
		id: node.id,
		label:
			node.content.length > 40
				? `${node.content.slice(0, 40)}...`
				: node.content,
		fill: NODE_COLORS[node.node_type] ?? NODE_COLORS.detail,
		size: NODE_SIZES[node.node_type] ?? NODE_SIZES.detail,
	};
}

export function buildTreeEdge(parentId: string, childId: string): GraphEdge {
	return {
		id: `tree__${parentId}__${childId}`,
		source: parentId,
		target: childId,
		size: 1,
		fill: TREE_EDGE_COLOR,
	};
}

export function getAncestors(graph: WillowGraph, nodeId: string): WillowNode[] {
	const ancestors: WillowNode[] = [];
	let current = graph.nodes[nodeId];
	while (current?.parent_id) {
		const parent = graph.nodes[current.parent_id];
		if (!parent) break;
		ancestors.push(parent);
		current = parent;
	}
	return ancestors;
}

function collectNeighborhood(
	graph: WillowGraph,
	nodeId: string,
): { target: WillowNode; parent: WillowNode | null; siblings: WillowNode[] } {
	const target = graph.nodes[nodeId];
	const parent = target?.parent_id
		? (graph.nodes[target.parent_id] ?? null)
		: null;
	const siblings: WillowNode[] = [];
	if (parent) {
		for (const childId of parent.children) {
			if (childId !== nodeId && graph.nodes[childId]) {
				siblings.push(graph.nodes[childId]);
			}
		}
	}
	return { target, parent, siblings };
}

export function buildSubgraphFromNodes(
	graph: WillowGraph,
	nodeIds: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];

	for (const id of nodeIds) {
		const node = graph.nodes[id];
		if (node) nodes.push(buildGraphNode(node));
	}

	// Tree edges
	for (const id of nodeIds) {
		const node = graph.nodes[id];
		if (node?.parent_id && nodeIds.has(node.parent_id)) {
			edges.push(buildTreeEdge(node.parent_id, id));
		}
	}

	// Cross-link edges
	for (const link of Object.values(graph.links)) {
		if (nodeIds.has(link.source_id) && nodeIds.has(link.target_id)) {
			edges.push({
				id: `link__${link.id}`,
				source: link.source_id,
				target: link.target_id,
				label: link.relation,
				size: 2,
				fill: LINK_COLORS[link.relation] ?? DEFAULT_LINK_COLOR,
			});
		}
	}

	return { nodes, edges };
}

// ---------- Extractors ----------

/**
 * BFS-collect nodes from root up to `limit`, returning them in BFS order.
 */
export function bfsCollect(
	graph: WillowGraph,
	limit: number,
): { collected: Set<string>; layers: string[][] } {
	const collected = new Set<string>();
	const layers: string[][] = [];
	if (!graph.root_id || !graph.nodes[graph.root_id]) {
		return { collected, layers };
	}

	let frontier = [graph.root_id];
	while (frontier.length > 0 && collected.size < limit) {
		const layer: string[] = [];
		for (const id of frontier) {
			if (collected.size >= limit) break;
			collected.add(id);
			layer.push(id);
		}
		layers.push(layer);

		const next: string[] = [];
		for (const id of frontier) {
			const node = graph.nodes[id];
			if (!node) continue;
			for (const childId of node.children) {
				if (!collected.has(childId) && graph.nodes[childId]) {
					next.push(childId);
				}
			}
		}
		frontier = next;
	}
	return { collected, layers };
}

/**
 * Build BFS animation phases from pre-computed layers.
 */
function buildBfsPhases(
	layers: string[][],
	edges: GraphEdge[],
	selectedNodeIds?: string[],
): AnimationPhase[] {
	const phases: AnimationPhase[] = [];
	const visited = new Set<string>();

	for (const layer of layers) {
		for (const id of layer) visited.add(id);

		const activeEdgeIds: string[] = [];
		for (const e of edges) {
			if (visited.has(e.source) && visited.has(e.target)) {
				activeEdgeIds.push(e.id);
			}
		}

		phases.push({
			activeNodeIds: [...visited],
			activeEdgeIds,
			selectedNodeIds: [],
		});
	}

	// Final phase: highlight matches
	if (selectedNodeIds && selectedNodeIds.length > 0 && phases.length > 0) {
		const last = phases[phases.length - 1];
		phases.push({
			activeNodeIds: last.activeNodeIds,
			activeEdgeIds: last.activeEdgeIds,
			selectedNodeIds,
		});
	}

	return phases;
}

function extractSearchNodes(
	graph: WillowGraph,
	_args: Record<string, unknown>,
	result: unknown,
): SubgraphData | null {
	// Parse matched IDs from result (if available)
	let matchedIds: string[] = [];
	const hasResult = result !== undefined && result !== null;
	if (hasResult) {
		try {
			const parsed = typeof result === "string" ? JSON.parse(result) : result;
			if (Array.isArray(parsed)) {
				matchedIds = parsed
					.map(
						(r: Record<string, unknown>) =>
							(r.nodeId as string) ?? (r.node_id as string) ?? (r.id as string),
					)
					.filter(Boolean);
			}
		} catch {
			// result not parseable — will show BFS-only animation
		}
	}

	if (hasResult && matchedIds.length === 0) {
		// Search completed but found nothing
		return null;
	}

	if (!hasResult) {
		// No result yet — show BFS "searching" animation across the tree
		const { collected, layers } = bfsCollect(graph, MAX_NODES);
		if (collected.size < 2) return null;

		const { nodes, edges } = buildSubgraphFromNodes(graph, collected);
		const phases = buildBfsPhases(layers, edges);
		// Dim everything back to just root — "waiting for results"
		phases.push({
			activeNodeIds: graph.root_id ? [graph.root_id] : [],
			activeEdgeIds: [],
			selectedNodeIds: [],
		});
		return { nodes, edges, phases, focusNodeIds: [graph.root_id] };
	}

	// Have matches — collect root + paths to matched nodes
	const collected = new Set<string>();
	if (graph.root_id) collected.add(graph.root_id);

	for (const id of matchedIds) {
		collected.add(id);
		for (const ancestor of getAncestors(graph, id)) {
			collected.add(ancestor.id);
			if (collected.size >= MAX_NODES) break;
		}
		if (collected.size >= MAX_NODES) break;
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	// BFS phases from root through the subgraph
	const layers: string[][] = [];
	const visited = new Set<string>();
	let frontier = graph.root_id ? [graph.root_id] : [];

	while (frontier.length > 0 && layers.length < 10) {
		const layer: string[] = [];
		for (const id of frontier) {
			visited.add(id);
			layer.push(id);
		}
		layers.push(layer);

		const next: string[] = [];
		for (const id of frontier) {
			const node = graph.nodes[id];
			if (!node) continue;
			for (const childId of node.children) {
				if (!visited.has(childId) && collected.has(childId)) {
					next.push(childId);
				}
			}
		}
		frontier = next;
	}

	const validMatches = matchedIds.filter((id) => collected.has(id));
	const bfsPhases = buildBfsPhases(layers, edges, validMatches);

	// Focused final phase: only matches + ancestor paths stay colored, rest dims
	const focusedIds = new Set<string>(validMatches);
	for (const id of validMatches) {
		for (const ancestor of getAncestors(graph, id)) {
			if (collected.has(ancestor.id)) focusedIds.add(ancestor.id);
		}
	}
	bfsPhases.push({
		activeNodeIds: [...focusedIds],
		activeEdgeIds: edges
			.filter((e) => focusedIds.has(e.source) && focusedIds.has(e.target))
			.map((e) => e.id),
		selectedNodeIds: validMatches,
	});

	return { nodes, edges, phases: bfsPhases, focusNodeIds: matchedIds };
}

function extractGetContext(
	graph: WillowGraph,
	args: Record<string, unknown>,
): SubgraphData | null {
	const nodeId = args.nodeId as string;
	const target = graph.nodes[nodeId];
	if (!target) return null;

	const collected = new Set<string>([nodeId]);

	// Ancestors
	for (const ancestor of getAncestors(graph, nodeId)) {
		collected.add(ancestor.id);
	}

	// Immediate children
	for (const childId of target.children) {
		if (graph.nodes[childId]) {
			collected.add(childId);
			if (collected.size >= MAX_NODES) break;
		}
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	// Phases: target first, expand to parent, then children
	const ancestorIds = getAncestors(graph, nodeId).map((n) => n.id);
	const childIds = target.children.filter((id) => collected.has(id));

	const coreIds = new Set([nodeId, ...ancestorIds]);
	const coreEdgeIds = edges
		.filter((e) => coreIds.has(e.source) && coreIds.has(e.target))
		.map((e) => e.id);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: [nodeId],
			activeEdgeIds: [],
			selectedNodeIds: [nodeId],
		},
		{
			activeNodeIds: [nodeId, ...ancestorIds],
			activeEdgeIds: coreEdgeIds,
			selectedNodeIds: [nodeId],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: edges.map((e) => e.id),
			selectedNodeIds: [nodeId],
		},
		// Final focused phase: dim children, keep target + ancestors
		{
			activeNodeIds: [...coreIds],
			activeEdgeIds: coreEdgeIds,
			selectedNodeIds: [nodeId],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [nodeId] };
}

function extractCreateNode(
	graph: WillowGraph,
	args: Record<string, unknown>,
	result: unknown,
): SubgraphData | null {
	let newNodeId: string | null = null;
	try {
		const parsed = typeof result === "string" ? JSON.parse(result) : result;
		newNodeId = (parsed as Record<string, unknown>)?.id as string;
	} catch {
		// fall through
	}

	const parentId = args.parentId as string;
	const parent = graph.nodes[parentId];
	if (!parent) return null;

	const collected = new Set<string>([parentId]);

	// Siblings
	for (const childId of parent.children) {
		if (graph.nodes[childId]) {
			collected.add(childId);
			if (collected.size >= MAX_NODES) break;
		}
	}

	// Add new node if it exists in the graph now
	if (newNodeId && graph.nodes[newNodeId]) {
		collected.add(newNodeId);
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	// If new node isn't in the graph yet, synthesize it
	if (newNodeId && !graph.nodes[newNodeId]) {
		nodes.push({
			id: newNodeId,
			label:
				typeof args.content === "string"
					? args.content.length > 40
						? `${args.content.slice(0, 40)}...`
						: args.content
					: "New node",
			fill: NODE_COLORS[(args.nodeType as NodeType) ?? "detail"],
			size: NODE_SIZES[(args.nodeType as NodeType) ?? "detail"],
		});
		edges.push(buildTreeEdge(parentId, newNodeId));
		collected.add(newNodeId);
	}

	const focusId = newNodeId ?? parentId;

	// Phases: parent area first, new node pops in, then focus on new node + parent
	const existingIds = [...collected].filter((id) => id !== newNodeId);
	const focusIds = new Set(newNodeId ? [parentId, newNodeId] : [parentId]);
	const focusEdgeIds = edges
		.filter((e) => focusIds.has(e.source) && focusIds.has(e.target))
		.map((e) => e.id);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: existingIds,
			activeEdgeIds: edges
				.filter(
					(e) =>
						existingIds.includes(e.source) && existingIds.includes(e.target),
				)
				.map((e) => e.id),
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: edges.map((e) => e.id),
			selectedNodeIds: newNodeId ? [newNodeId] : [],
		},
		// Final focused phase: dim siblings, keep parent + new node
		{
			activeNodeIds: [...focusIds],
			activeEdgeIds: focusEdgeIds,
			selectedNodeIds: newNodeId ? [newNodeId] : [],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [focusId] };
}

function extractUpdateNode(
	graph: WillowGraph,
	args: Record<string, unknown>,
): SubgraphData | null {
	const nodeId = args.nodeId as string;
	const { target, parent, siblings } = collectNeighborhood(graph, nodeId);
	if (!target) return null;

	const collected = new Set<string>([nodeId]);
	if (parent) collected.add(parent.id);
	for (const s of siblings) {
		collected.add(s.id);
		if (collected.size >= MAX_NODES) break;
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: [...collected],
			activeEdgeIds: edges.map((e) => e.id),
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: edges.map((e) => e.id),
			selectedNodeIds: [nodeId],
		},
		// Final focused phase: dim neighbors, keep target
		{
			activeNodeIds: [nodeId],
			activeEdgeIds: [],
			selectedNodeIds: [nodeId],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [nodeId] };
}

function extractDeleteNode(
	graph: WillowGraph,
	args: Record<string, unknown>,
): SubgraphData | null {
	const nodeId = args.nodeId as string;
	const { target, parent, siblings } = collectNeighborhood(graph, nodeId);
	if (!target) return null;

	const collected = new Set<string>([nodeId]);
	if (parent) collected.add(parent.id);
	for (const s of siblings) {
		collected.add(s.id);
		if (collected.size >= MAX_NODES) break;
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: [...collected],
			activeEdgeIds: edges.map((e) => e.id),
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: edges.map((e) => e.id),
			selectedNodeIds: [nodeId],
		},
		// Final focused phase: dim neighbors, keep target
		{
			activeNodeIds: [nodeId],
			activeEdgeIds: [],
			selectedNodeIds: [nodeId],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [nodeId] };
}

function extractAddLink(
	graph: WillowGraph,
	args: Record<string, unknown>,
): SubgraphData | null {
	const sourceId = args.sourceId as string;
	const targetId = args.targetId as string;
	const sourceNode = graph.nodes[sourceId];
	const targetNode = graph.nodes[targetId];
	if (!sourceNode || !targetNode) return null;

	const collected = new Set<string>([sourceId, targetId]);

	// Add parents of both
	if (sourceNode.parent_id && graph.nodes[sourceNode.parent_id]) {
		collected.add(sourceNode.parent_id);
	}
	if (targetNode.parent_id && graph.nodes[targetNode.parent_id]) {
		collected.add(targetNode.parent_id);
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	// Synthesize the new link edge if not already present
	const relation = (args.relation as string) ?? "related_to";
	const newEdgeId = `link__${sourceId}__${targetId}__new`;
	const hasEdge = edges.some(
		(e) =>
			e.source === sourceId &&
			e.target === targetId &&
			e.id.startsWith("link__"),
	);
	if (!hasEdge) {
		edges.push({
			id: newEdgeId,
			source: sourceId,
			target: targetId,
			label: relation,
			size: 2,
			fill: LINK_COLORS[relation] ?? DEFAULT_LINK_COLOR,
		});
	}
	const linkEdgeId = hasEdge
		? (edges.find(
				(e) =>
					e.source === sourceId &&
					e.target === targetId &&
					e.id.startsWith("link__"),
			)?.id ?? newEdgeId)
		: newEdgeId;

	// Phases: source side, target side, then link
	const sourceIds = [sourceId];
	if (sourceNode.parent_id && collected.has(sourceNode.parent_id))
		sourceIds.push(sourceNode.parent_id);

	const targetIds = [targetId];
	if (targetNode.parent_id && collected.has(targetNode.parent_id))
		targetIds.push(targetNode.parent_id);

	const allIds = [...collected];
	const treeEdgeIds = edges
		.filter((e) => e.id.startsWith("tree__"))
		.map((e) => e.id);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: sourceIds,
			activeEdgeIds: treeEdgeIds.filter((eid) => {
				const e = edges.find((edge) => edge.id === eid);
				return (
					e && sourceIds.includes(e.source) && sourceIds.includes(e.target)
				);
			}),
			selectedNodeIds: [],
		},
		{
			activeNodeIds: allIds,
			activeEdgeIds: treeEdgeIds,
			selectedNodeIds: [],
		},
		{
			activeNodeIds: allIds,
			activeEdgeIds: [...treeEdgeIds, linkEdgeId],
			selectedNodeIds: [sourceId, targetId],
		},
		// Final focused phase: dim parents, keep endpoints + link
		{
			activeNodeIds: [sourceId, targetId],
			activeEdgeIds: [linkEdgeId],
			selectedNodeIds: [sourceId, targetId],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [sourceId, targetId] };
}

// ---------- Dispatcher ----------

const TOOL_PREFIX = "mcp__willow__";

export function extractSubgraph(
	toolName: string,
	graph: WillowGraph,
	args: Record<string, unknown>,
	result: unknown,
): SubgraphData | null {
	const name = toolName.startsWith(TOOL_PREFIX)
		? toolName.slice(TOOL_PREFIX.length)
		: toolName;

	switch (name) {
		case "search_nodes":
			return extractSearchNodes(graph, args, result);
		case "get_context":
			return extractGetContext(graph, args);
		case "create_node":
			return extractCreateNode(graph, args, result);
		case "update_node":
			return extractUpdateNode(graph, args);
		case "delete_node":
			return extractDeleteNode(graph, args);
		case "add_link":
			return extractAddLink(graph, args);
		default:
			return null;
	}
}
