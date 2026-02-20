import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../../lib/graph-types.js";
import {
	bfsCollect,
	buildSubgraphFromNodes,
	getAncestors,
} from "./subgraph-extractors.js";
import type { SearchLayer } from "./types.js";

const MAX_MERGED_NODES = 60;
const DIMMED_COLOR = "#d1d5db";
const EXPLORED_COLOR = "#b0b8c4";
const DIMMED_EDGE_COLOR = "#e5e7eb";
const EXPLORED_EDGE_COLOR = "#cbd5e1";

const TOOL_PREFIX = "mcp__willow__";

interface SearchToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
}

async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}

function stripToolPrefix(name: string): string {
	return name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
}

/**
 * Extract node IDs from a SETTLED tool call (one that has a result).
 */
function extractSettledNodeIds(
	graph: WillowGraph,
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
): { nodeIds: Set<string>; focusNodeIds: string[] } {
	const name = stripToolPrefix(toolName);
	const nodeIds = new Set<string>();
	const focusNodeIds: string[] = [];

	if (name === "search_nodes") {
		let matchedIds: string[] = [];
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
			// not parseable
		}

		if (matchedIds.length > 0) {
			if (graph.root_id) nodeIds.add(graph.root_id);
			for (const id of matchedIds) {
				if (!graph.nodes[id]) continue;
				nodeIds.add(id);
				focusNodeIds.push(id);
				for (const ancestor of getAncestors(graph, id)) {
					nodeIds.add(ancestor.id);
					if (nodeIds.size >= MAX_MERGED_NODES) break;
				}
				if (nodeIds.size >= MAX_MERGED_NODES) break;
			}
		}
	} else if (name === "get_context") {
		const nodeId = args.nodeId as string;
		const target = graph.nodes[nodeId];
		if (target) {
			nodeIds.add(nodeId);
			focusNodeIds.push(nodeId);
			for (const ancestor of getAncestors(graph, nodeId)) {
				nodeIds.add(ancestor.id);
			}
			for (const childId of target.children) {
				if (graph.nodes[childId]) {
					nodeIds.add(childId);
					if (nodeIds.size >= MAX_MERGED_NODES) break;
				}
			}
		}
	}

	return { nodeIds, focusNodeIds };
}

export interface CumulativeSearchGraphState {
	nodes: GraphNode[];
	edges: GraphEdge[];
	selections: string[];
	actives: string[];
	layers: SearchLayer[];
	activeLayerIndex: number;
	setActiveLayerIndex: (index: number) => void;
}

export function useCumulativeSearchGraph(
	toolCalls: SearchToolCall[],
): CumulativeSearchGraphState {
	const { data: graph } = useQuery<WillowGraph>({
		queryKey: ["graph"],
		queryFn: fetchGraph,
	});

	const [activeLayerIndex, setActiveLayerIndex] = useState(-1);
	const prevCountRef = useRef(0);

	const result = useMemo(() => {
		if (!graph) {
			return {
				nodes: [],
				edges: [],
				selections: [],
				actives: [],
				layers: [] as SearchLayer[],
			};
		}

		const layers: SearchLayer[] = [];
		const mergedNodeIds = new Set<string>();
		const anyPending = toolCalls.some(
			(tc) => tc.result === undefined || tc.result === null,
		);

		// If any tool call is still pending, we need BFS nodes as background
		let bfsNodeIds: Set<string> | null = null;
		if (anyPending) {
			const { collected } = bfsCollect(graph, MAX_MERGED_NODES);
			bfsNodeIds = collected;
			for (const id of collected) mergedNodeIds.add(id);
		}

		for (const tc of toolCalls) {
			const hasResult = tc.result !== undefined && tc.result !== null;
			const name = stripToolPrefix(tc.toolName);

			if (hasResult) {
				const { nodeIds, focusNodeIds } = extractSettledNodeIds(
					graph,
					tc.toolName,
					tc.args,
					tc.result,
				);

				for (const id of nodeIds) mergedNodeIds.add(id);

				layers.push({
					toolCallId: tc.toolCallId,
					toolName: name,
					nodeIds,
					focusNodeIds,
					status: "settled",
				});
			} else {
				// Pending tool call — use BFS as the layer's node set
				// Focus on target if known (get_context), otherwise root
				const focusNodeIds: string[] = [];
				const nodeIds = bfsNodeIds ?? new Set<string>();

				if (name === "get_context") {
					const nodeId = tc.args.nodeId as string;
					if (graph.nodes[nodeId]) {
						focusNodeIds.push(nodeId);
					}
				} else if (name === "search_nodes") {
					// Search is exploring the whole graph — focus on root
					if (graph.root_id) {
						focusNodeIds.push(graph.root_id);
					}
				}

				layers.push({
					toolCallId: tc.toolCallId,
					toolName: name,
					nodeIds,
					focusNodeIds,
					status: "pending",
				});
			}

			if (mergedNodeIds.size >= MAX_MERGED_NODES) break;
		}

		// Build merged graph from all collected node IDs
		const { nodes, edges } = buildSubgraphFromNodes(graph, mergedNodeIds);

		// Determine active layer
		const effectiveLayerIndex =
			activeLayerIndex === -1 || toolCalls.length !== prevCountRef.current
				? layers.length - 1
				: activeLayerIndex;

		const activeLayer = layers[effectiveLayerIndex];
		const activeNodeIds = activeLayer?.nodeIds ?? new Set<string>();
		const activeFocusIds = activeLayer?.focusNodeIds ?? [];

		// Collect nodes from all prior settled layers
		const priorNodeIds = new Set<string>();
		for (let i = 0; i < effectiveLayerIndex; i++) {
			if (layers[i].status === "settled") {
				for (const id of layers[i].nodeIds) {
					priorNodeIds.add(id);
				}
			}
		}

		// Dimming logic depends on whether the active layer is pending or settled
		const focusSet = new Set(activeFocusIds);
		const isActiveLayerPending = activeLayer?.status === "pending";

		const displayNodes: GraphNode[] = nodes.map((n) => {
			if (isActiveLayerPending) {
				// During pending: show prior settled results in explored color,
				// everything else in real color (the graph is being actively searched)
				if (priorNodeIds.has(n.id)) {
					return focusSet.has(n.id) ? n : { ...n, fill: EXPLORED_COLOR };
				}
				return n;
			}

			// Settled active layer: highlight active nodes, dim the rest
			if (focusSet.has(n.id)) {
				return n; // Focus: real color + selection ring
			}
			if (activeNodeIds.has(n.id)) {
				return n; // Active layer: real color
			}
			if (priorNodeIds.has(n.id)) {
				return { ...n, fill: EXPLORED_COLOR }; // Prior layers: semi-dimmed
			}
			return { ...n, fill: DIMMED_COLOR }; // Background: fully dimmed
		});

		const displayEdges: GraphEdge[] = edges.map((e) => {
			if (isActiveLayerPending) {
				if (priorNodeIds.has(e.source) && priorNodeIds.has(e.target)) {
					return { ...e, fill: EXPLORED_EDGE_COLOR };
				}
				return e;
			}

			if (activeNodeIds.has(e.source) && activeNodeIds.has(e.target)) {
				return e;
			}
			if (priorNodeIds.has(e.source) && priorNodeIds.has(e.target)) {
				return { ...e, fill: EXPLORED_EDGE_COLOR };
			}
			return { ...e, fill: DIMMED_EDGE_COLOR };
		});

		const selections = activeFocusIds.filter((id) => mergedNodeIds.has(id));

		// Pulse focus nodes when active layer is pending
		const actives: string[] = isActiveLayerPending ? [...activeFocusIds] : [];

		return {
			nodes: displayNodes,
			edges: displayEdges,
			selections,
			actives,
			layers,
		};
	}, [graph, toolCalls, activeLayerIndex]);

	// Auto-follow latest layer when new tool calls arrive
	if (toolCalls.length !== prevCountRef.current) {
		prevCountRef.current = toolCalls.length;
		if (activeLayerIndex !== -1) {
			setActiveLayerIndex(-1);
		}
	}

	return {
		...result,
		activeLayerIndex:
			activeLayerIndex === -1 ? result.layers.length - 1 : activeLayerIndex,
		setActiveLayerIndex,
	};
}
