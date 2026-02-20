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

function edgeIdsForNodes(edges: GraphEdge[], nodeIds: Set<string>): string[] {
	return edges
		.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
		.map((e) => e.id);
}

function allEdgeIds(edges: GraphEdge[]): string[] {
	return edges.map((e) => e.id);
}

function getAncestorIds(graph: WillowGraph, nodeId: string): string[] {
	return getAncestors(graph, nodeId).map((n) => n.id);
}

function addAncestors(
	graph: WillowGraph,
	nodeId: string,
	collected: Set<string>,
): void {
	for (const ancestor of getAncestors(graph, nodeId)) {
		collected.add(ancestor.id);
		if (collected.size >= MAX_NODES) break;
	}
}

function addChildren(
	graph: WillowGraph,
	nodeId: string,
	collected: Set<string>,
): void {
	const node = graph.nodes[nodeId];
	if (!node) return;
	for (const childId of node.children) {
		if (graph.nodes[childId]) {
			collected.add(childId);
			if (collected.size >= MAX_NODES) break;
		}
	}
}

function addParent(
	graph: WillowGraph,
	nodeId: string,
	collected: Set<string>,
): void {
	const node = graph.nodes[nodeId];
	if (node?.parent_id && graph.nodes[node.parent_id]) {
		collected.add(node.parent_id);
	}
}

function collectNeighborhoodIds(
	graph: WillowGraph,
	nodeId: string,
): Set<string> | null {
	const target = graph.nodes[nodeId];
	if (!target) return null;

	const collected = new Set<string>([nodeId]);
	const parent = target.parent_id
		? (graph.nodes[target.parent_id] ?? null)
		: null;
	if (parent) {
		collected.add(parent.id);
		for (const childId of parent.children) {
			if (childId !== nodeId && graph.nodes[childId]) {
				collected.add(childId);
				if (collected.size >= MAX_NODES) break;
			}
		}
	}
	return collected;
}

function bfsOverSubset(
	graph: WillowGraph,
	startIds: string[],
	subset: Set<string>,
	maxLayers: number,
): string[][] {
	const layers: string[][] = [];
	const visited = new Set<string>();
	let frontier = startIds.filter((id) => subset.has(id));

	while (frontier.length > 0 && layers.length < maxLayers) {
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
				if (!visited.has(childId) && subset.has(childId)) {
					next.push(childId);
				}
			}
		}
		frontier = next;
	}
	return layers;
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
		if (nodeIds.has(link.from_node) && nodeIds.has(link.to_node)) {
			edges.push({
				id: `link__${link.id}`,
				source: link.from_node,
				target: link.to_node,
				label: link.relation,
				size: 2,
				fill: LINK_COLORS[link.relation] ?? DEFAULT_LINK_COLOR,
			});
		}
	}

	return { nodes, edges };
}

// ---------- Extractors ----------

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

function buildBfsPhases(
	layers: string[][],
	edges: GraphEdge[],
	selectedNodeIds?: string[],
): AnimationPhase[] {
	const phases: AnimationPhase[] = [];
	const visited = new Set<string>();

	for (const layer of layers) {
		for (const id of layer) visited.add(id);

		phases.push({
			activeNodeIds: [...visited],
			activeEdgeIds: edgeIdsForNodes(edges, visited),
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
		return null;
	}

	if (!hasResult) {
		// No result yet — show BFS "searching" animation across the tree
		const { collected, layers } = bfsCollect(graph, MAX_NODES);
		if (collected.size < 2) return null;

		const { nodes, edges } = buildSubgraphFromNodes(graph, collected);
		const phases = buildBfsPhases(layers, edges);
		phases.push({
			activeNodeIds: graph.root_id ? [graph.root_id] : [],
			activeEdgeIds: [],
			selectedNodeIds: [],
		});
		return { nodes, edges, phases, focusNodeIds: [graph.root_id] };
	}

	const collected = new Set<string>();
	if (graph.root_id) collected.add(graph.root_id);

	for (const id of matchedIds) {
		collected.add(id);
		addAncestors(graph, id, collected);
		if (collected.size >= MAX_NODES) break;
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	const layers = bfsOverSubset(
		graph,
		graph.root_id ? [graph.root_id] : [],
		collected,
		10,
	);

	const validMatches = matchedIds.filter((id) => collected.has(id));
	const bfsPhases = buildBfsPhases(layers, edges, validMatches);

	const focusedIds = new Set<string>(validMatches);
	for (const id of validMatches) {
		for (const a of getAncestorIds(graph, id)) {
			if (collected.has(a)) focusedIds.add(a);
		}
	}
	bfsPhases.push({
		activeNodeIds: [...focusedIds],
		activeEdgeIds: edgeIdsForNodes(edges, focusedIds),
		selectedNodeIds: validMatches,
	});

	return { nodes, edges, phases: bfsPhases, focusNodeIds: matchedIds };
}

function extractGetContext(
	graph: WillowGraph,
	args: Record<string, unknown>,
): SubgraphData | null {
	const nodeId = args.nodeId as string;
	if (!graph.nodes[nodeId]) return null;

	const collected = new Set<string>([nodeId]);
	addAncestors(graph, nodeId, collected);
	addChildren(graph, nodeId, collected);

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	const ancestorIds = getAncestorIds(graph, nodeId);
	const coreIds = new Set([nodeId, ...ancestorIds]);
	const coreEdgeIds = edgeIdsForNodes(edges, coreIds);

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
			activeEdgeIds: allEdgeIds(edges),
			selectedNodeIds: [nodeId],
		},
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
	if (!graph.nodes[parentId]) return null;

	const collected = new Set<string>([parentId]);
	addChildren(graph, parentId, collected);

	if (newNodeId && graph.nodes[newNodeId]) {
		collected.add(newNodeId);
	}

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

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
	const selectedIds = newNodeId ? [newNodeId] : [];
	const existingIds = [...collected].filter((id) => id !== newNodeId);
	const focusIds = new Set(newNodeId ? [parentId, newNodeId] : [parentId]);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: existingIds,
			activeEdgeIds: edgeIdsForNodes(edges, new Set(existingIds)),
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: allEdgeIds(edges),
			selectedNodeIds: selectedIds,
		},
		{
			activeNodeIds: [...focusIds],
			activeEdgeIds: edgeIdsForNodes(edges, focusIds),
			selectedNodeIds: selectedIds,
		},
	];

	return { nodes, edges, phases, focusNodeIds: [focusId] };
}

function extractNeighborhoodFocus(
	graph: WillowGraph,
	args: Record<string, unknown>,
): SubgraphData | null {
	const nodeId = args.nodeId as string;
	const collected = collectNeighborhoodIds(graph, nodeId);
	if (!collected) return null;

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);
	const allIds = allEdgeIds(edges);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: [...collected],
			activeEdgeIds: allIds,
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: allIds,
			selectedNodeIds: [nodeId],
		},
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
	if (!graph.nodes[sourceId] || !graph.nodes[targetId]) return null;

	const collected = new Set<string>([sourceId, targetId]);
	addParent(graph, sourceId, collected);
	addParent(graph, targetId, collected);

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	const relation = (args.relation as string) ?? "related_to";
	const newEdgeId = `link__${sourceId}__${targetId}__new`;
	const existingLinkEdge = edges.find(
		(e) =>
			e.source === sourceId &&
			e.target === targetId &&
			e.id.startsWith("link__"),
	);
	if (!existingLinkEdge) {
		edges.push({
			id: newEdgeId,
			source: sourceId,
			target: targetId,
			label: relation,
			size: 2,
			fill: LINK_COLORS[relation] ?? DEFAULT_LINK_COLOR,
		});
	}
	const linkEdgeId = existingLinkEdge?.id ?? newEdgeId;

	const treeEdges = edges.filter((e) => e.id.startsWith("tree__"));
	const treeEdgeIds = treeEdges.map((e) => e.id);
	const sourceParentId = graph.nodes[sourceId].parent_id;
	const sourceIds =
		sourceParentId && collected.has(sourceParentId)
			? [sourceId, sourceParentId]
			: [sourceId];

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: sourceIds,
			activeEdgeIds: edgeIdsForNodes(treeEdges, new Set(sourceIds)),
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: treeEdgeIds,
			selectedNodeIds: [],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: [...treeEdgeIds, linkEdgeId],
			selectedNodeIds: [sourceId, targetId],
		},
		{
			activeNodeIds: [sourceId, targetId],
			activeEdgeIds: [linkEdgeId],
			selectedNodeIds: [sourceId, targetId],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [sourceId, targetId] };
}

function extractWalkGraph(
	graph: WillowGraph,
	_args: Record<string, unknown>,
	result: unknown,
): SubgraphData | null {
	if (!result) return null;

	let parsed: {
		position?: { id: string };
		path?: { id: string }[];
		children?: { id: string }[];
	};
	try {
		parsed = typeof result === "string" ? JSON.parse(result) : result;
	} catch {
		return null;
	}

	if (!parsed.position?.id) return null;

	const positionId = parsed.position.id;
	const pathIds = (parsed.path ?? []).map((n) => n.id);
	const childIds = (parsed.children ?? []).map((n) => n.id);

	const collected = new Set<string>([positionId]);
	for (const id of [...pathIds, ...childIds]) {
		if (graph.nodes[id]) collected.add(id);
	}

	if (collected.size < 2) return null;

	const { nodes, edges } = buildSubgraphFromNodes(graph, collected);

	const phases: AnimationPhase[] = [
		{
			activeNodeIds: [positionId],
			activeEdgeIds: [],
			selectedNodeIds: [positionId],
		},
		{
			activeNodeIds: [...collected],
			activeEdgeIds: allEdgeIds(edges),
			selectedNodeIds: [positionId],
		},
	];

	return { nodes, edges, phases, focusNodeIds: [positionId] };
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
		case "delete_node":
			return extractNeighborhoodFocus(graph, args);
		case "add_link":
			return extractAddLink(graph, args);
		case "walk_graph":
			return extractWalkGraph(graph, args, result);
		default:
			return null;
	}
}
